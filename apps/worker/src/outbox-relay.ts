import { getWorkerPool, type Pool } from '@hrms/db';
import { AuditRepository, getLogger } from '@hrms/core';

const logger = getLogger().child({ service: 'outbox-relay' });

export class OutboxRelayWorker {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private auditRepo = new AuditRepository();
  private pool: Pool;

  constructor(poolOverride?: Pool) {
    this.pool = poolOverride ?? getWorkerPool();
  }

  async processBatch(): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const events = await this.auditRepo.fetchUnprocessedOutbox(50, client);
      if (events.length === 0) {
        await client.query('COMMIT');
        return 0;
      }

      logger.info({ count: events.length }, 'Processing outbox events batch...');

      const processedIds: string[] = [];

      for (const event of events) {
        try {
          // Here events can be dispatched to BullMQ queues, webhooks, or external systems
          logger.debug(
            { id: event.id, type: event.type, aggregate: event.aggregate },
            'Dispatched outbox event',
          );
          processedIds.push(event.id);
        } catch (dispatchErr) {
          logger.error({ err: dispatchErr, eventId: event.id }, 'Failed to dispatch outbox event');
          // Increment attempt count
          await client.query(
            `UPDATE outbox_events SET attempts = attempts + 1 WHERE id = $1`,
            [event.id],
          );
        }
      }

      if (processedIds.length > 0) {
        await this.auditRepo.markOutboxProcessed(processedIds, client);
      }

      await client.query('COMMIT');
      return processedIds.length;
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ err }, 'Error during outbox relay batch processing');
      return 0;
    } finally {
      client.release();
    }
  }

  start(intervalMs = 2000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info({ intervalMs }, 'Outbox relay worker started.');

    const tick = async () => {
      if (!this.isRunning) return;
      try {
        await this.processBatch();
      } catch (err) {
        logger.error({ err }, 'Unhandled error in outbox relay tick');
      } finally {
        if (this.isRunning) {
          this.timer = setTimeout(tick, intervalMs);
        }
      }
    };

    this.timer = setTimeout(tick, intervalMs);
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logger.info('Outbox relay worker stopped.');
  }
}
