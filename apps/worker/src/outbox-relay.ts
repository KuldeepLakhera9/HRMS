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

          // Handle Sprint 1.3 Domain Events
          if (event.type === 'change_request.created') {
            const employeeId = event.payload.employeeId as string | undefined;
            if (employeeId) {
              const empRes = await client.query<{ managerId: string; fullName: string }>(
                `SELECT manager_id as "managerId", first_name || ' ' || last_name as "fullName"
                 FROM employees WHERE company_id = $1 AND id = $2`,
                [event.companyId, employeeId],
              );
              const emp = empRes.rows[0];
              if (emp?.managerId) {
                const mgrUserRes = await client.query<{ userId: string }>(
                  `SELECT user_id as "userId" FROM employees WHERE company_id = $1 AND id = $2`,
                  [event.companyId, emp.managerId],
                );
                const mgrUserId = mgrUserRes.rows[0]?.userId;
                if (mgrUserId) {
                  await client.query(
                    `INSERT INTO notifications (id, company_id, user_id, type, title, body, link)
                     VALUES (gen_random_uuid(), $1, $2, 'change_request', $3, $4, '/admin/change-requests')`,
                    [
                      event.companyId,
                      mgrUserId,
                      'Profile Change Request',
                      `${emp.fullName} has submitted a profile change request for review.`,
                    ],
                  );
                }
              }
            }
          } else if (event.type === 'change_request.decided') {
            const employeeId = event.payload.employeeId as string | undefined;
            const decision = event.payload.decision as string | undefined;
            if (employeeId) {
              const empUserRes = await client.query<{ userId: string }>(
                `SELECT user_id as "userId" FROM employees WHERE company_id = $1 AND id = $2`,
                [event.companyId, employeeId],
              );
              const userId = empUserRes.rows[0]?.userId;
              if (userId) {
                await client.query(
                  `INSERT INTO notifications (id, company_id, user_id, type, title, body, link)
                   VALUES (gen_random_uuid(), $1, $2, 'change_request', $3, $4, $5)`,
                  [
                    event.companyId,
                    userId,
                    `Change Request ${decision === 'approved' ? 'Approved' : 'Rejected'}`,
                    `Your profile change request was ${decision}.`,
                    `/employees/${employeeId}`,
                  ],
                );
              }
            }
          } else if (event.type === 'document.uploaded') {
            const fileId = event.payload.fileId as string | undefined;
            if (fileId) {
              await client.query(
                `UPDATE files SET status = 'clean', updated_at = now()
                 WHERE company_id = $1 AND id = $2 AND status = 'pending'`,
                [event.companyId, fileId],
              );
            }
          } else if (event.type === 'document.verified' || event.type === 'document.rejected') {
            const employeeId = event.payload.employeeId as string | undefined;
            const status = event.payload.status as string | undefined;
            if (employeeId) {
              const empUserRes = await client.query<{ userId: string }>(
                `SELECT user_id as "userId" FROM employees WHERE company_id = $1 AND id = $2`,
                [event.companyId, employeeId],
              );
              const userId = empUserRes.rows[0]?.userId;
              if (userId) {
                await client.query(
                  `INSERT INTO notifications (id, company_id, user_id, type, title, body, link)
                   VALUES (gen_random_uuid(), $1, $2, 'document', $3, $4, $5)`,
                  [
                    event.companyId,
                    userId,
                    `Document ${status === 'verified' ? 'Verified' : 'Rejected'}`,
                    `Your uploaded document has been ${status}.`,
                    `/employees/${employeeId}`,
                  ],
                );
              }
            }
          }

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
