import { getWorkerPool, type Pool } from '@hrms/db';
import { getLogger } from '@hrms/core';

const logger = getLogger().child({ service: 'workflow-sweep' });

export class WorkflowSlaSweepWorker {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private pool: Pool;

  constructor(poolOverride?: Pool) {
    this.pool = poolOverride ?? getWorkerPool();
  }

  /**
   * Scans overdue pending workflow steps using SELECT ... FOR UPDATE SKIP LOCKED.
   */
  async sweepOverdueSteps(): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const sql = `
        SELECT
          ws.id as "stepId",
          ws.company_id as "companyId",
          ws.request_id as "requestId",
          ws.step_index as "stepIndex",
          ws.name as "stepName",
          ws.due_at as "dueAt",
          wr.entity_type as "entityType",
          wr.entity_id as "entityId",
          wr.requester_id as "requesterId"
        FROM workflow_steps ws
        JOIN workflow_requests wr ON wr.company_id = ws.company_id AND wr.id = ws.request_id AND wr.deleted_at IS NULL
        WHERE ws.status = 'pending'
          AND ws.due_at IS NOT NULL
          AND ws.due_at <= NOW()
          AND ws.escalated_at IS NULL
        ORDER BY ws.due_at ASC
        LIMIT 50
        FOR UPDATE OF ws SKIP LOCKED
      `;

      const res = await client.query<{
        stepId: string;
        companyId: string;
        requestId: string;
        stepIndex: number;
        stepName: string;
        dueAt: string;
        entityType: string;
        entityId: string;
        requesterId: string;
      }>(sql);

      if (res.rows.length === 0) {
        await client.query('COMMIT');
        return 0;
      }

      logger.info({ count: res.rows.length }, 'Found overdue workflow steps. Emitting SLA escalation events...');

      for (const step of res.rows) {
        // Mark as escalated
        await client.query(
          `UPDATE workflow_steps
           SET escalated_at = NOW(), updated_at = NOW()
           WHERE id = $1`,
          [step.stepId],
        );

        // Emit domain outbox event
        await client.query(
          `INSERT INTO outbox_events (id, company_id, aggregate, type, payload)
           VALUES (gen_random_uuid(), $1, 'workflow', 'workflow.step.overdue', $2)`,
          [
            step.companyId,
            JSON.stringify({
              stepId: step.stepId,
              requestId: step.requestId,
              stepIndex: step.stepIndex,
              stepName: step.stepName,
              entityType: step.entityType,
              entityId: step.entityId,
              dueAt: step.dueAt,
            }),
          ],
        );
      }

      await client.query('COMMIT');
      return res.rows.length;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      logger.error({ err }, 'Error during workflow SLA sweep');
      return 0;
    } finally {
      client.release();
    }
  }

  start(intervalMs = 15 * 60 * 1000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info('Workflow SLA sweep worker started.');

    this.timer = setInterval(() => {
      this.sweepOverdueSteps().catch(err => {
        logger.error({ err }, 'Error in SLA sweep execution');
      });
    }, intervalMs);
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info('Workflow SLA sweep worker stopped.');
  }
}
