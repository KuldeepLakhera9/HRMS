import { getWorkerPool, type Pool } from '@hrms/db';
import { getLogger } from '@hrms/core';

const logger = getLogger().child({ service: 'partition-maintenance' });

export class PartitionMaintenanceWorker {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private pool: Pool;

  constructor(poolOverride?: Pool) {
    this.pool = poolOverride ?? getWorkerPool();
  }

  /**
   * Ensures audit_logs partitions exist for the current month and the next 2 months.
   */
  async ensureFuturePartitions(): Promise<string[]> {
    const client = await this.pool.connect();
    const createdPartitions: string[] = [];

    try {
      const now = new Date();
      for (let offset = 0; offset <= 2; offset++) {
        const targetDate = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        const year = targetDate.getFullYear();
        const month = targetDate.getMonth() + 1; // 1-12

        const auditRes = await client.query<{ create_audit_logs_partition: string }>(
          `SELECT create_audit_logs_partition($1, $2)`,
          [year, month],
        );
        const auditPart = auditRes.rows[0]?.create_audit_logs_partition;
        if (auditPart) {
          createdPartitions.push(auditPart);
        }

        const punchRes = await client.query<{ create_attendance_punches_partition: string }>(
          `SELECT create_attendance_punches_partition($1, $2)`,
          [year, month],
        );
        const punchPart = punchRes.rows[0]?.create_attendance_punches_partition;
        if (punchPart) {
          createdPartitions.push(punchPart);
        }
      }

      logger.info(
        { partitions: createdPartitions },
        'Partition maintenance completed successfully.',
      );
      return createdPartitions;
    } catch (err) {
      logger.error({ err }, 'Error during partition maintenance check');
      return [];
    } finally {
      client.release();
    }
  }

  start(intervalMs = 24 * 60 * 60 * 1000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info('Partition maintenance worker started.');

    // Run once on startup
    this.ensureFuturePartitions().catch(err => {
      logger.error({ err }, 'Initial partition maintenance run failed');
    });

    this.timer = setInterval(() => {
      this.ensureFuturePartitions().catch(err => {
        logger.error({ err }, 'Scheduled partition maintenance run failed');
      });
    }, intervalMs);
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('Partition maintenance worker stopped.');
  }
}
