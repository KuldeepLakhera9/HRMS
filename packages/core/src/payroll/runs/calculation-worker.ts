import { Decimal } from 'decimal.js';
import { and, eq, inArray, isNull, sql, desc } from 'drizzle-orm';
import {
  Database,
  employees,
  payrollRuns,
  payrollEmployeeRuns,
  payslips,
  PayrollRun,
  PayrollEmployeeRun,
  NewPayrollEmployeeRun,
} from '@hrms/db';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../../routing/context.js';
import { getRedisClient } from '../../redis/client.js';
import { computePayslip } from '../engines/payslip.js';
import { StatutoryRulesRepository } from '../rules/repository.js';
import { PayrollRunRepository } from './repository.js';
import { PayrollBulkLoader } from './bulk-loader.js';
import { WarningsBlockersEngine, VarianceBaseline } from './warnings-blockers.js';
import { executeRunTransition } from './state-machine.js';

export interface RunCalculationProgress {
  runId: string;
  status: string;
  total: number;
  processed: number;
  included: number;
  held: number;
  errors: number;
  warningsCount: number;
  gross: string;
  net: string;
}

export class PayrollCalculationWorker {
  constructor(
    private runRepo = new PayrollRunRepository(),
    private rulesRepo = new StatutoryRulesRepository(),
    private bulkLoader = new PayrollBulkLoader(),
    private warningsEngine = new WarningsBlockersEngine(),
  ) {}

  /**
   * Orchestrates the calculation of a payroll run in bounded 100-employee chunks.
   * Resumable, idempotent, error-isolated, and streams real-time SSE progress via Redis.
   */
  async calculateRun(
    ctx: RequestContext,
    db: Database,
    runId: string,
    options: { employeeIds?: string[]; resume?: boolean; chunkSize?: number; forceRecalculate?: boolean } = {},
  ): Promise<PayrollRun> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_CALCULATE)) {
      throw new ForbiddenError('Permission denied: payroll.run.calculate required');
    }

    const run = await this.runRepo.getRunById(db, ctx.companyId, runId);
    if (!run) {
      throw new NotFoundError('Payroll run not found');
    }

    let currentStatus = run.status;
    if (currentStatus === 'calculated') {
      await executeRunTransition(ctx, db, runId, 'draft');
      currentStatus = 'draft';
    }
    if (currentStatus === 'draft') {
      await executeRunTransition(ctx, db, runId, 'inputs_ready', {
        skipAttendanceLockCheck: true,
      });
      currentStatus = 'inputs_ready';
    }

    if (currentStatus !== 'inputs_ready' && currentStatus !== 'calculating') {
      throw new ValidationError(
        `Cannot calculate payroll run in status '${currentStatus}'. Run must be in 'inputs_ready' or 'calculating'`,
      );
    }

    // Transition to calculating if not already there
    if (currentStatus === 'inputs_ready') {
      await executeRunTransition(ctx, db, runId, 'calculating');
    }

    const period = await this.runRepo.getPeriodById(db, ctx.companyId, run.periodId);
    if (!period) {
      throw new NotFoundError('Payroll period for run not found');
    }

    // 1. Cache active statutory rules once for the run
    const activeRules = await this.rulesRepo.getActiveRuleSetsForPeriod(
      db,
      ctx.companyId,
      period.startDate,
    );
    const cachedRules: Record<string, unknown> = {};
    for (const r of activeRules) {
      cachedRules[r.key] = r.payload;
    }

    // 2. Identify target employees
    let targetEmployeeIds = options.employeeIds;
    if (!targetEmployeeIds || targetEmployeeIds.length === 0) {
      const activeEmps = await db
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(
            eq(employees.companyId, ctx.companyId),
            eq(employees.legalEntityId, period.legalEntityId),
            isNull(employees.deletedAt),
          ),
        );
      targetEmployeeIds = activeEmps.map(e => e.id);
    }

    const totalEmployees = targetEmployeeIds.length;
    const chunkSize = options.chunkSize || 100;
    const redis = getRedisClient();
    const progressChannel = `payroll:run:${ctx.companyId}:${runId}`;

    let processedCount = 0;
    let includedCount = 0;
    let heldCount = 0;
    let errorCount = 0;
    let totalWarningsCount = 0;
    let runningGross = new Decimal('0.00');
    let runningNet = new Decimal('0.00');
    let runningDeductions = new Decimal('0.00');
    let runningEmployerCost = new Decimal('0.00');

    // 3. Process in chunks of 100
    for (let i = 0; i < targetEmployeeIds.length; i += chunkSize) {
      const chunkIds = targetEmployeeIds.slice(i, i + chunkSize);

      // Load all domain data for chunk in <= 8 queries
      const bulkData = await this.bulkLoader.loadChunkData(
        db,
        ctx.companyId,
        period.legalEntityId,
        period.period,
        period.fy,
        chunkIds,
      );

      // Load existing staged runs for chunk to check input_hash and held statuses
      const existingStaged = await db
        .select()
        .from(payrollEmployeeRuns)
        .where(
          and(
            eq(payrollEmployeeRuns.companyId, ctx.companyId),
            eq(payrollEmployeeRuns.runId, runId),
            inArray(payrollEmployeeRuns.employeeId, chunkIds),
          ),
        );
      const existingStagedMap = new Map<string, PayrollEmployeeRun>();
      for (const st of existingStaged) existingStagedMap.set(st.employeeId, st);

      // Load previous payslips for variance baseline
      const prevPayslips = await db
        .select({
          employeeId: payslips.employeeId,
          gross: payslips.gross,
          net: payslips.net,
        })
        .from(payslips)
        .where(
          and(
            eq(payslips.companyId, ctx.companyId),
            inArray(payslips.employeeId, chunkIds),
          ),
        )
        .orderBy(desc(payslips.period));
      const prevPayslipMap = new Map<string, { gross: string; net: string }>();
      for (const p of prevPayslips) {
        if (!prevPayslipMap.has(p.employeeId)) {
          prevPayslipMap.set(p.employeeId, { gross: p.gross, net: p.net });
        }
      }

      const upsertRows: NewPayrollEmployeeRun[] = [];

      for (const empId of chunkIds) {
        processedCount++;
        const existing = existingStagedMap.get(empId);
        const prev = prevPayslipMap.get(empId);
        const baseline: VarianceBaseline = {
          previousGross: prev?.gross ?? undefined,
          previousNet: prev?.net ?? undefined,
          hasPreviousPayslip: Boolean(prev),
        };

        try {
          const payslipInput = this.bulkLoader.assemblePayslipInput(
            empId,
            period.period,
            bulkData,
            cachedRules,
            30,
          );

          if (!payslipInput) {
            // Cannot assemble: missing salary structure or employee
            errorCount++;
            upsertRows.push({
              companyId: ctx.companyId,
              runId,
              employeeId: empId,
              status: 'error',
              holdReason: 'Missing active salary assignment or structure',
              warnings: [],
              blockers: ['MISSING_SALARY_OR_STRUCTURE: No approved salary assignment found'],
              inputHash: null,
              calcVersion: (existing?.calcVersion || 0) + 1,
              gross: '0.00',
              deductions: '0.00',
              employerCost: '0.00',
              net: '0.00',
              result: {},
              createdBy: ctx.userId || empId,
              updatedBy: ctx.userId || empId,
            });
            continue;
          }

          // Pure computation
          const result = computePayslip(payslipInput);

          // Evaluate policy warnings and blockers
          const flags = this.warningsEngine.evaluate(payslipInput, result, baseline);
          const allBlockers = Array.from(new Set([...result.blockers, ...flags.blockers]));
          const allWarnings = Array.from(new Set([...result.warnings, ...flags.warnings]));

          totalWarningsCount += allWarnings.length;

          // Determine status
          let empStatus: 'included' | 'held' | 'excluded' | 'error' = 'included';
          let holdReason = existing?.holdReason || null;

          if (existing?.status === 'held') {
            empStatus = 'held';
            heldCount++;
          } else if (allBlockers.length > 0) {
            empStatus = 'held';
            holdReason = allBlockers[0] || 'Unresolved blocker';
            heldCount++;
          } else {
            includedCount++;
          }

          runningGross = runningGross.plus(new Decimal(result.gross));
          runningDeductions = runningDeductions.plus(new Decimal(result.deductions));
          runningNet = runningNet.plus(new Decimal(result.net));
          runningEmployerCost = runningEmployerCost.plus(new Decimal(result.employerCost));

          upsertRows.push({
            companyId: ctx.companyId,
            runId,
            employeeId: empId,
            status: empStatus,
            holdReason,
            warnings: allWarnings,
            blockers: allBlockers,
            inputHash: result.inputHash,
            calcVersion: (existing?.calcVersion || 0) + 1,
            gross: result.gross,
            deductions: result.deductions,
            employerCost: result.employerCost,
            net: result.net,
            result: result as unknown as Record<string, unknown>,
            createdBy: ctx.userId || empId,
            updatedBy: ctx.userId || empId,
          });
        } catch (calcError: unknown) {
          // Error isolation per employee
          errorCount++;
          const errorMsg = calcError instanceof Error ? calcError.message : String(calcError);
          upsertRows.push({
            companyId: ctx.companyId,
            runId,
            employeeId: empId,
            status: 'error',
            holdReason: `Calculation failed: ${errorMsg}`,
            warnings: [],
            blockers: [`CALCULATION_EXCEPTION: ${errorMsg}`],
            inputHash: null,
            calcVersion: (existing?.calcVersion || 0) + 1,
            gross: '0.00',
            deductions: '0.00',
            employerCost: '0.00',
            net: '0.00',
            result: {},
            createdBy: ctx.userId || empId,
            updatedBy: ctx.userId || empId,
          });
        }
      }

      // Upsert chunk in batch
      if (upsertRows.length > 0) {
        await db
          .insert(payrollEmployeeRuns)
          .values(upsertRows)
          .onConflictDoUpdate({
            target: [
              payrollEmployeeRuns.companyId,
              payrollEmployeeRuns.runId,
              payrollEmployeeRuns.employeeId,
            ],
            set: {
              status: sql`EXCLUDED.status`,
              holdReason: sql`EXCLUDED.hold_reason`,
              warnings: sql`EXCLUDED.warnings`,
              blockers: sql`EXCLUDED.blockers`,
              inputHash: sql`EXCLUDED.input_hash`,
              calcVersion: sql`EXCLUDED.calc_version`,
              gross: sql`EXCLUDED.gross`,
              deductions: sql`EXCLUDED.deductions`,
              employerCost: sql`EXCLUDED.employer_cost`,
              net: sql`EXCLUDED.net`,
              result: sql`EXCLUDED.result`,
              updatedAt: new Date(),
              updatedBy: ctx.userId,
            },
          });
      }

      // Publish live SSE progress
      const progressPayload: RunCalculationProgress = {
        runId,
        status: 'calculating',
        total: totalEmployees,
        processed: processedCount,
        included: includedCount,
        held: heldCount,
        errors: errorCount,
        warningsCount: totalWarningsCount,
        gross: runningGross.toFixed(2),
        net: runningNet.toFixed(2),
      };

      try {
        await redis.publish(progressChannel, JSON.stringify(progressPayload));
      } catch {
        // Redis non-fatal
      }
    }

    // 4. Update payroll_runs totals & counts
    const finalCounts = {
      total: totalEmployees,
      included: includedCount,
      held: heldCount,
      excluded: 0,
      errors: errorCount,
    };

    const finalTotals = {
      gross: runningGross.toFixed(2),
      deductions: runningDeductions.toFixed(2),
      net: runningNet.toFixed(2),
      employerCost: runningEmployerCost.toFixed(2),
    };

    await db
      .update(payrollRuns)
      .set({
        counts: finalCounts,
        totals: finalTotals,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(and(eq(payrollRuns.companyId, ctx.companyId), eq(payrollRuns.id, runId)));

    // 5. Transition to calculated
    const updatedRun = await executeRunTransition(ctx, db, runId, 'calculated');

    // Final SSE notification
    try {
      await redis.publish(
        progressChannel,
        JSON.stringify({
          ...finalCounts,
          runId,
          status: 'calculated',
          processed: totalEmployees,
          gross: runningGross.toFixed(2),
          net: runningNet.toFixed(2),
        }),
      );
    } catch {
      // Redis non-fatal
    }

    return updatedRun;
  }
}
