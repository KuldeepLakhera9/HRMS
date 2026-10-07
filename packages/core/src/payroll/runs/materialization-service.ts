import crypto from 'node:crypto';
import { Decimal } from 'decimal.js';
import { and, eq, sql, inArray, isNull } from 'drizzle-orm';
import {
  Database,
  payrollRuns,
  payrollEmployeeRuns,
  payslips,
  payslipLines,
  payrollYtd,
  payrollInputs,
  loanInstallments,
  NewPayslip,
  NewPayslipLine,
  PayrollRun,
} from '@hrms/db';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../../routing/context.js';
import { PayrollRunRepository } from './repository.js';
import { executeRunTransition } from './state-machine.js';
import { assertSegregationOfDuties } from '../maker-checker.js';

function canonicalStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalStringify).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys.map(
    k => `${JSON.stringify(k)}:${canonicalStringify((obj as Record<string, unknown>)[k])}`,
  );
  return '{' + entries.join(',') + '}';
}

export class PayslipMaterializationService {
  constructor(private runRepo = new PayrollRunRepository()) {}

  /**
   * Materializes immutable payslips, payslip_lines, updates YTD ledger,
   * consumes approved inputs, recovers loan installments, and seals the run into LOCKED status.
   */
  async materializeAndLockRun(
    ctx: RequestContext,
    db: Database,
    runId: string,
    options: { chunkSize?: number } = {},
  ): Promise<PayrollRun> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_LOCK)) {
      throw new ForbiddenError('Permission denied: payroll.run.lock required');
    }
    const userId = ctx.userId;
    if (!userId) {
      throw new UnauthorizedError('User authentication required');
    }

    const run = await this.runRepo.getRunById(db, ctx.companyId, runId);
    if (!run) {
      throw new NotFoundError('Payroll run not found');
    }

    if (run.status !== 'approved' && run.status !== 'locking') {
      throw new ValidationError(
        `Payroll run cannot be locked from status '${run.status}'. Run must be in 'approved' or 'locking'`,
      );
    }

    assertSegregationOfDuties(run.createdBy, userId, 'locking payroll run');

    // 1. Transition to 'locking' state if not already there
    if (run.status === 'approved') {
      await executeRunTransition(ctx, db, runId, 'locking');
    }

    // 2. Precondition check: verify zero un-held employees with blockers or errors
    const stagedUnresolved = await db
      .select({ id: payrollEmployeeRuns.id, employeeId: payrollEmployeeRuns.employeeId, blockers: payrollEmployeeRuns.blockers })
      .from(payrollEmployeeRuns)
      .where(
        and(
          eq(payrollEmployeeRuns.companyId, ctx.companyId),
          eq(payrollEmployeeRuns.runId, runId),
          sql`${payrollEmployeeRuns.status} != 'held'`,
          sql`(${payrollEmployeeRuns.status} = 'error' OR jsonb_array_length(${payrollEmployeeRuns.blockers}) > 0)`,
        ),
      );

    if (stagedUnresolved.length > 0) {
      throw new ValidationError(
        `Cannot lock payroll run: ${stagedUnresolved.length} employee(s) have unresolved errors or blockers. Please resolve blockers or explicitly place employees on hold before locking.`,
      );
    }

    const period = await this.runRepo.getPeriodById(db, ctx.companyId, run.periodId);
    if (!period) {
      throw new NotFoundError('Payroll period not found');
    }

    // 3. Materialize in chunks of 100
    const chunkSize = options.chunkSize || 100;
    const includedStaged = await db
      .select()
      .from(payrollEmployeeRuns)
      .where(
        and(
          eq(payrollEmployeeRuns.companyId, ctx.companyId),
          eq(payrollEmployeeRuns.runId, runId),
          eq(payrollEmployeeRuns.status, 'included'),
        ),
      );

    for (let i = 0; i < includedStaged.length; i += chunkSize) {
      const chunk = includedStaged.slice(i, i + chunkSize);
      const payslipInserts: NewPayslip[] = [];

      for (const st of chunk) {
        const rawRes = st.result as Record<string, unknown>;
        const rawLines = (rawRes.lines || []) as Array<{
          code: string;
          name: string;
          kind: 'earning' | 'deduction' | 'employer_contribution' | 'reimbursement';
          amount: string;
          taxableAmount: string;
          ruleRef?: string;
        }>;

        const snapshot = {
          period: period.period,
          employeeId: st.employeeId,
          gross: st.gross,
          deductions: st.deductions,
          employerCost: st.employerCost,
          net: st.net,
          lines: rawLines,
          ruleVersions: run.ruleVersions,
          settingsSnapshot: run.settingsSnapshot,
          engineVersion: run.engineVersion,
        };

        const integrityHash = crypto
          .createHash('sha256')
          .update(canonicalStringify(snapshot))
          .digest('hex');

        payslipInserts.push({
          companyId: ctx.companyId,
          runId,
          employeeId: st.employeeId,
          period: period.period,
          gross: st.gross,
          deductions: st.deductions,
          employerCost: st.employerCost,
          net: st.net,
          integrityHash,
          snapshot,
          paymentStatus: 'pending',
          createdBy: userId,
          updatedBy: userId,
        });
      }

      // Insert payslips (idempotent ON CONFLICT DO NOTHING)
      if (payslipInserts.length > 0) {
        await db
          .insert(payslips)
          .values(payslipInserts)
          .onConflictDoNothing();

        // If newly inserted or previously inserted, map payslip IDs
        const currentPayslips = await db
          .select({ id: payslips.id, employeeId: payslips.employeeId })
          .from(payslips)
          .where(
            and(
              eq(payslips.companyId, ctx.companyId),
              eq(payslips.runId, runId),
              inArray(
                payslips.employeeId,
                chunk.map(c => c.employeeId),
              ),
            ),
          );

        const payslipIdByEmp = new Map<string, string>();
        for (const cp of currentPayslips) {
          payslipIdByEmp.set(cp.employeeId, cp.id);
        }

        const linesInserts: NewPayslipLine[] = [];
        const ytdMap = new Map<string, typeof payrollYtd.$inferInsert>();

        // Insert payslip lines and accumulate chunk YTD deltas
        for (const st of chunk) {
          const pId = payslipIdByEmp.get(st.employeeId);
          if (!pId) continue;

          const rawRes = st.result as Record<string, unknown>;
          const rawLines = (rawRes.lines || []) as Array<{
            code: string;
            kind: 'earning' | 'deduction' | 'employer_contribution' | 'reimbursement';
            amount: string;
            taxableAmount?: string;
            ruleRef?: string;
          }>;

          let sortOrder = 1;
          for (const l of rawLines) {
            linesInserts.push({
              companyId: ctx.companyId,
              payslipId: pId,
              runId,
              employeeId: st.employeeId,
              componentCode: l.code,
              kind: l.kind,
              amount: l.amount,
              taxableAmount: l.taxableAmount || '0.00',
              sortOrder: sortOrder++,
              ruleRef: l.ruleRef || null,
              createdBy: userId,
            });

            // Aggregate YTD deltas per employee + component in chunk
            const ytdKey = `${st.employeeId}:${l.code}`;
            const existing = ytdMap.get(ytdKey);
            if (existing) {
              existing.amount = new Decimal(existing.amount).plus(new Decimal(l.amount)).toFixed(2);
            } else {
              ytdMap.set(ytdKey, {
                companyId: ctx.companyId,
                employeeId: st.employeeId,
                fy: period.fy,
                componentCode: l.code,
                amount: l.amount,
                lastRunId: runId,
              });
            }
          }
        }

        if (linesInserts.length > 0) {
          await db.insert(payslipLines).values(linesInserts).onConflictDoNothing();
        }

        if (ytdMap.size > 0) {
          await db
            .insert(payrollYtd)
            .values(Array.from(ytdMap.values()))
            .onConflictDoUpdate({
              target: [
                payrollYtd.companyId,
                payrollYtd.employeeId,
                payrollYtd.fy,
                payrollYtd.componentCode,
              ],
              set: {
                amount: sql`${payrollYtd.amount} + EXCLUDED.amount`,
                lastRunId: sql`EXCLUDED.last_run_id`,
                updatedAt: new Date(),
              },
            });
        }
      }
    }

    // 4. Mark inputs consumed for the period
    await db
      .update(payrollInputs)
      .set({
        status: 'consumed',
        consumedRunId: runId,
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(
        and(
          eq(payrollInputs.companyId, ctx.companyId),
          eq(payrollInputs.forPeriod, period.period),
          eq(payrollInputs.status, 'approved'),
          isNull(payrollInputs.deletedAt),
        ),
      );

    // 5. Mark loan installments recovered
    await db
      .update(loanInstallments)
      .set({
        status: 'recovered',
        recoveredRunId: runId,
        recoveredAt: new Date(),
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(
        and(
          eq(loanInstallments.companyId, ctx.companyId),
          eq(loanInstallments.duePeriod, period.period),
          eq(loanInstallments.status, 'due'),
          isNull(loanInstallments.deletedAt),
        ),
      );

    // 6. Compute canonical run_hash over all payslip integrity hashes
    const allPayslips = await db
      .select({
        id: payslips.id,
        employeeId: payslips.employeeId,
        integrityHash: payslips.integrityHash,
      })
      .from(payslips)
      .where(and(eq(payslips.companyId, ctx.companyId), eq(payslips.runId, runId)))
      .orderBy(payslips.employeeId);

    const hashConcat = allPayslips.map(p => p.integrityHash).join(':');
    const runHash = crypto.createHash('sha256').update(hashConcat).digest('hex');

    // 7. Verify control totals match staged results
    const stagedTotals = (run.totals || {}) as { net?: string; gross?: string };
    const payslipSum = await db
      .select({
        count: sql<number>`count(*)::int`,
        totalNet: sql<string>`coalesce(sum(${payslips.net}), 0.00)::text`,
      })
      .from(payslips)
      .where(and(eq(payslips.companyId, ctx.companyId), eq(payslips.runId, runId)));

    const materializedCount = payslipSum[0]?.count || 0;
    const materializedNet = new Decimal(payslipSum[0]?.totalNet || '0.00').toFixed(2);
    const stagedNet = new Decimal(stagedTotals.net || '0.00').toFixed(2);

    if (materializedCount !== includedStaged.length) {
      throw new Error(
        `Materialization count mismatch: expected ${includedStaged.length} payslips, materialized ${materializedCount}`,
      );
    }
    if (materializedNet !== stagedNet) {
      throw new Error(
        `Materialization control total mismatch: expected Net ${stagedNet}, materialized ${materializedNet}`,
      );
    }

    // 8. Seal the run with run_hash and lock metadata
    await db
      .update(payrollRuns)
      .set({
        runHash,
        lockedBy: userId,
        lockedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(and(eq(payrollRuns.companyId, ctx.companyId), eq(payrollRuns.id, runId)));

    // 9. Atomically advance to locked state
    return executeRunTransition(ctx, db, runId, 'locked');
  }
}
