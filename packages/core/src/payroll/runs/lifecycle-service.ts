import { and, eq, sql } from 'drizzle-orm';
import {
  Database,
  payrollRuns,
  payrollPeriods,
  payslips,
  payslipLines,
  payrollInputs,
  loanInstallments,
  expenseClaims,
  payrollRunEvents,
  PayrollRun,
} from '@hrms/db';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../../routing/context.js';
import { PayrollRunRepository } from './repository.js';
import { executeRunTransition } from './state-machine.js';
import { assertSecondApproverCanUnlock } from './guards.js';

export interface UnlockRunOptions {
  reason: string;
  secondApproverId: string;
}

export class PayrollLifecycleService {
  constructor(private runRepo = new PayrollRunRepository()) {}

  /**
   * Unlocks a locked payroll run, reverting it back to 'review'.
   * Enforces:
   * 1. Caller must have 'payroll.run.unlock'.
   * 2. Run status must be strictly 'locked' (cannot unlock if 'published' or 'paid').
   * 3. Distinct second approver (cannot be caller, cannot be creator, cannot be locker).
   * 4. Second approver must hold 'payroll.run.unlock'.
   * 5. Atomically:
   *    - Reverts YTD delta amounts for the run.
   *    - Deletes materialized draft payslips and payslip_lines (via app.allow_unlock session flag).
   *    - Reverts consumed inputs back to 'approved'.
   *    - Reverts recovered loan installments back to 'due'.
   *    - Reverts expense claims back to 'approved'.
   *    - Transitions run to 'review' with reason and audit log.
   */
  async unlockRun(
    ctx: RequestContext,
    db: Database,
    runId: string,
    options: UnlockRunOptions,
  ): Promise<PayrollRun> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_UNLOCK)) {
      throw new ForbiddenError('Permission denied: payroll.run.unlock required');
    }

    if (!options.reason || options.reason.trim().length < 5) {
      throw new ValidationError('A detailed reason (at least 5 characters) is required to unlock a run');
    }

    if (!options.secondApproverId) {
      throw new ValidationError('Second approver ID is required to unlock a payroll run');
    }

    const run = await this.runRepo.getRunById(db, ctx.companyId, runId);
    if (!run) {
      throw new NotFoundError('Payroll run not found');
    }

    if (run.status !== 'locked') {
      throw new ValidationError(`Cannot unlock run in '${run.status}' state. Only 'locked' runs can be unlocked.`);
    }

    // Segregation of Duties (SoD) for unlock:
    // Second approver cannot be the current user
    if (options.secondApproverId === ctx.userId) {
      throw new ValidationError('Self-approval rejected: second approver must be a different user');
    }

    // Second approver cannot be the creator or the user who locked the run
    if (run.createdBy && options.secondApproverId === run.createdBy) {
      throw new ValidationError('Second approver cannot be the original creator of the payroll run');
    }

    // Verify second approver credentials & permissions
    await assertSecondApproverCanUnlock(ctx.companyId, options.secondApproverId);

    // Fetch period to get financial year
    const [period] = await db
      .select({ fy: payrollPeriods.fy })
      .from(payrollPeriods)
      .where(and(eq(payrollPeriods.companyId, ctx.companyId), eq(payrollPeriods.id, run.periodId)));

    const fy = period?.fy || '';

    // Execute unlock rollback inside a single database transaction
    const updatedRun = await db.transaction(async tx => {
      // 1. Set session configuration allowing immutability trigger bypass for this authorized rollback
      await tx.execute(sql`SELECT set_config('app.allow_unlock', 'true', true)`);

      // 2. Revert YTD amounts using payslip_lines before deletion
      if (fy) {
        await tx.execute(sql`
          UPDATE payroll_ytd py
          SET amount = py.amount - sub.total_amount,
              updated_at = now()
          FROM (
            SELECT pl.employee_id, pl.component_code, sum(pl.amount::numeric) as total_amount
            FROM payslip_lines pl
            WHERE pl.company_id = ${ctx.companyId} AND pl.run_id = ${runId}
            GROUP BY pl.employee_id, pl.component_code
          ) sub
          WHERE py.company_id = ${ctx.companyId}
            AND py.employee_id = sub.employee_id
            AND py.component_code = sub.component_code
            AND py.fy = ${fy};
        `);
      }

      // 3. Delete payslip lines & payslips for this run
      await tx
        .delete(payslipLines)
        .where(and(eq(payslipLines.companyId, ctx.companyId), eq(payslipLines.runId, runId)));

      await tx
        .delete(payslips)
        .where(and(eq(payslips.companyId, ctx.companyId), eq(payslips.runId, runId)));

      // 4. Revert consumed payroll inputs
      await tx
        .update(payrollInputs)
        .set({
          status: 'approved',
          consumedRunId: null,
          updatedAt: new Date(),
          updatedBy: ctx.userId ?? 'system',
        })
        .where(
          and(
            eq(payrollInputs.companyId, ctx.companyId),
            eq(payrollInputs.consumedRunId, runId),
          ),
        );

      // 5. Revert recovered loan installments
      await tx
        .update(loanInstallments)
        .set({
          status: 'due',
          recoveredRunId: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(loanInstallments.companyId, ctx.companyId),
            eq(loanInstallments.recoveredRunId, runId),
          ),
        );

      // 6. Revert expense claims paid via payroll
      await tx
        .update(expenseClaims)
        .set({
          status: 'approved',
          payoutRef: null,
          paidAt: null,
          updatedAt: new Date(),
          updatedBy: ctx.userId ?? 'system',
        })
        .where(
          and(
            eq(expenseClaims.companyId, ctx.companyId),
            eq(expenseClaims.payoutRef, runId),
          ),
        );

      // 7. Transition state machine from 'locked' to 'review'
      const transitioned = await executeRunTransition(ctx, tx, runId, 'review', {
        reason: options.reason,
        secondApproverId: options.secondApproverId,
      });

      // 8. Record dedicated audit event
      await tx.insert(payrollRunEvents).values({
        companyId: ctx.companyId,
        runId,
        actorId: ctx.userId ?? 'system',
        fromStatus: 'locked',
        toStatus: 'review',
        event: 'RUN_UNLOCKED',
        details: {
          action: 'RUN_UNLOCKED',
          reason: options.reason,
          secondApproverId: options.secondApproverId,
          unlockedBy: ctx.userId,
        },
      });

      return transitioned;
    });

    return updatedRun;
  }

  /**
   * Publishes a locked payroll run.
   * Advances status to 'published', timestamps payslips, and enables employee self-service access.
   */
  async publishRun(
    ctx: RequestContext,
    db: Database,
    runId: string,
  ): Promise<PayrollRun> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_PUBLISH)) {
      throw new ForbiddenError('Permission denied: payroll.run.publish required');
    }

    const run = await this.runRepo.getRunById(db, ctx.companyId, runId);
    if (!run) {
      throw new NotFoundError('Payroll run not found');
    }

    if (run.status !== 'locked') {
      throw new ValidationError(`Cannot publish run in '${run.status}' state. Run must be 'locked' first.`);
    }

    return await db.transaction(async tx => {
      // 1. Advance state machine 'locked' -> 'published'
      const updated = await executeRunTransition(ctx, tx, runId, 'published');

      // 2. Mark all payslips as published
      const now = new Date();
      await tx
        .update(payslips)
        .set({
          publishedAt: now,
          updatedAt: now,
          updatedBy: ctx.userId ?? 'system',
        })
        .where(and(eq(payslips.companyId, ctx.companyId), eq(payslips.runId, runId)));

      // 3. Append audit event
      await tx.insert(payrollRunEvents).values({
        companyId: ctx.companyId,
        runId,
        actorId: ctx.userId ?? 'system',
        fromStatus: 'locked',
        toStatus: 'published',
        event: 'PAYSLIPS_PUBLISHED',
        details: {
          action: 'PAYSLIPS_PUBLISHED',
          publishedAt: now.toISOString(),
          publishedBy: ctx.userId,
        },
      });

      return updated;
    });
  }

  /**
   * Creates an off-cycle or correction payroll run linked to a parent period/run.
   */
  async createCorrectionRun(
    ctx: RequestContext,
    db: Database,
    parentRunId: string,
    options: { notes?: string; runType?: 'correction' | 'off_cycle' | 'final' } = {},
  ): Promise<PayrollRun> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_CREATE)) {
      throw new ForbiddenError('Permission denied: payroll.run.create required');
    }

    const parent = await this.runRepo.getRunById(db, ctx.companyId, parentRunId);
    if (!parent) {
      throw new NotFoundError('Parent payroll run not found');
    }

    if (!['locked', 'published', 'paid'].includes(parent.status)) {
      throw new ValidationError('Correction or off-cycle runs can only be spawned from locked or published runs');
    }

    const runType = options.runType || 'correction';

    return await db.transaction(async tx => {
      // Find highest sequence for this period
      const [seqRow] = await tx
        .select({ maxSeq: sql<number>`coalesce(max(${payrollRuns.sequence}), 1)::int` })
        .from(payrollRuns)
        .where(and(eq(payrollRuns.companyId, ctx.companyId), eq(payrollRuns.periodId, parent.periodId)));

      const nextSequence = (seqRow?.maxSeq ?? 1) + 1;

      const [created] = await tx
        .insert(payrollRuns)
        .values({
          companyId: ctx.companyId,
          periodId: parent.periodId,
          runType,
          sequence: nextSequence,
          status: 'draft',
          notes: options.notes ?? `Correction run spawned from Run #${parent.sequence} (${parent.id})`,
          createdBy: ctx.userId ?? 'system',
          updatedBy: ctx.userId ?? 'system',
        })
        .returning();

      if (!created) {
        throw new Error('Failed to create correction payroll run');
      }

      await tx.insert(payrollRunEvents).values({
        companyId: ctx.companyId,
        runId: created.id,
        actorId: ctx.userId ?? 'system',
        fromStatus: 'draft',
        toStatus: 'draft',
        event: 'CORRECTION_RUN_CREATED',
        details: {
          action: 'CORRECTION_RUN_CREATED',
          parentRunId,
          runType,
          sequence: nextSequence,
        },
      });

      return created;
    });
  }
}
