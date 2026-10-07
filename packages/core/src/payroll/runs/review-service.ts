import { and, eq, sql, desc, lt, inArray } from 'drizzle-orm';
import {
  Database,
  payrollRuns,
  payrollPeriods,
  payrollEmployeeRuns,
  payrollRunEvents,
  employees,
} from '@hrms/db';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../../routing/context.js';
import { PayrollRunRepository } from './repository.js';
import { PayrollBulkLoader } from './bulk-loader.js';
import { computePayslip, PayslipCalculationResult, PayslipLineItem } from '../engines/payslip.js';

export interface RunSummaryStats {
  runId: string;
  status: string;
  headcount: number;
  includedCount: number;
  heldCount: number;
  excludedCount: number;
  errorCount: number;
  blockersCount: number;
  warningsCount: number;
  totals: {
    gross: string;
    deductions: string;
    employerCost: string;
    net: string;
  };
  heldTotals: {
    gross: string;
    net: string;
  };
  canApprove: boolean;
  canLock: boolean;
  canCalculate: boolean;
}

export interface StagedEmployeeListItem {
  id: string;
  employeeId: string;
  empCode: string;
  firstName: string;
  lastName: string;
  emailWork: string;
  status: 'included' | 'held' | 'excluded' | 'error';
  holdReason: string | null;
  gross: string;
  deductions: string;
  employerCost: string;
  net: string;
  blockers: string[];
  warnings: string[];
  inputHash: string | null;
  calcVersion: number;
}

export interface VarianceItem {
  employeeId: string;
  empCode: string;
  firstName: string;
  lastName: string;
  emailWork: string;
  currentStatus: string;
  currentGross: string;
  currentNet: string;
  priorGross: string;
  priorNet: string;
  grossDiff: string;
  grossPctChange: number;
  varianceCategory: 'NEW_JOINER' | 'LEAVER_OR_EXCLUDED' | 'VARIANCE' | 'UNCHANGED' | 'FIRST_PAYROLL';
}

export class PayrollReviewService {
  constructor(
    private runRepo = new PayrollRunRepository(),
    private bulkLoader = new PayrollBulkLoader(),
  ) {}

  /**
   * Retrieves high-level run summary cards data.
   * Single set-based aggregation query against payroll_employee_runs.
   */
  async getSummary(ctx: RequestContext, db: Database, runId: string): Promise<RunSummaryStats> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_READ) && !ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_REVIEW)) {
      throw new ForbiddenError('Permission denied: payroll.run.read or payroll.run.review required');
    }

    const run = await this.runRepo.getRunById(db, ctx.companyId, runId);
    if (!run) {
      throw new NotFoundError('Payroll run not found');
    }

    const [stats] = await db
      .select({
        totalCount: sql<number>`count(*)::int`,
        includedCount: sql<number>`count(*) filter (where ${payrollEmployeeRuns.status} = 'included')::int`,
        heldCount: sql<number>`count(*) filter (where ${payrollEmployeeRuns.status} = 'held')::int`,
        excludedCount: sql<number>`count(*) filter (where ${payrollEmployeeRuns.status} = 'excluded')::int`,
        errorCount: sql<number>`count(*) filter (where ${payrollEmployeeRuns.status} = 'error')::int`,
        blockersCount: sql<number>`count(*) filter (where jsonb_array_length(${payrollEmployeeRuns.blockers}) > 0)::int`,
        warningsCount: sql<number>`count(*) filter (where jsonb_array_length(${payrollEmployeeRuns.warnings}) > 0)::int`,
        totalGross: sql<string>`coalesce(sum(${payrollEmployeeRuns.gross}) filter (where ${payrollEmployeeRuns.status} = 'included'), 0)::text`,
        totalDeductions: sql<string>`coalesce(sum(${payrollEmployeeRuns.deductions}) filter (where ${payrollEmployeeRuns.status} = 'included'), 0)::text`,
        totalEmployerCost: sql<string>`coalesce(sum(${payrollEmployeeRuns.employerCost}) filter (where ${payrollEmployeeRuns.status} = 'included'), 0)::text`,
        totalNet: sql<string>`coalesce(sum(${payrollEmployeeRuns.net}) filter (where ${payrollEmployeeRuns.status} = 'included'), 0)::text`,
        heldGross: sql<string>`coalesce(sum(${payrollEmployeeRuns.gross}) filter (where ${payrollEmployeeRuns.status} = 'held'), 0)::text`,
        heldNet: sql<string>`coalesce(sum(${payrollEmployeeRuns.net}) filter (where ${payrollEmployeeRuns.status} = 'held'), 0)::text`,
      })
      .from(payrollEmployeeRuns)
      .where(
        and(
          eq(payrollEmployeeRuns.companyId, ctx.companyId),
          eq(payrollEmployeeRuns.runId, runId),
        ),
      );

    const errorCount = stats?.errorCount ?? 0;
    const blockersCount = stats?.blockersCount ?? 0;

    return {
      runId: run.id,
      status: run.status,
      headcount: stats?.totalCount ?? 0,
      includedCount: stats?.includedCount ?? 0,
      heldCount: stats?.heldCount ?? 0,
      excludedCount: stats?.excludedCount ?? 0,
      errorCount,
      blockersCount,
      warningsCount: stats?.warningsCount ?? 0,
      totals: {
        gross: parseFloat(stats?.totalGross ?? '0').toFixed(2),
        deductions: parseFloat(stats?.totalDeductions ?? '0').toFixed(2),
        employerCost: parseFloat(stats?.totalEmployerCost ?? '0').toFixed(2),
        net: parseFloat(stats?.totalNet ?? '0').toFixed(2),
      },
      heldTotals: {
        gross: parseFloat(stats?.heldGross ?? '0').toFixed(2),
        net: parseFloat(stats?.heldNet ?? '0').toFixed(2),
      },
      canApprove: run.status === 'calculated' && blockersCount === 0 && errorCount === 0,
      canLock: run.status === 'approved',
      canCalculate: ['draft', 'calculated', 'rejected'].includes(run.status),
    };
  }

  /**
   * Keyset-paginated list of staged employee records for the run.
   */
  async listEmployees(
    ctx: RequestContext,
    db: Database,
    runId: string,
    options: {
      cursor?: string;
      limit?: number;
      status?: 'included' | 'held' | 'excluded' | 'error' | 'all';
      hasBlockers?: boolean;
      hasWarnings?: boolean;
      search?: string;
    } = {},
  ): Promise<{ items: StagedEmployeeListItem[]; nextCursor: string | null }> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_READ) && !ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_REVIEW)) {
      throw new ForbiddenError('Permission denied: payroll.run.read or payroll.run.review required');
    }

    const limit = Math.min(100, Math.max(1, options.limit ?? 50));
    const conditions = [
      eq(payrollEmployeeRuns.companyId, ctx.companyId),
      eq(payrollEmployeeRuns.runId, runId),
    ];

    if (options.status && options.status !== 'all') {
      conditions.push(eq(payrollEmployeeRuns.status, options.status));
    }

    if (options.hasBlockers) {
      conditions.push(sql`jsonb_array_length(${payrollEmployeeRuns.blockers}) > 0`);
    }

    if (options.hasWarnings) {
      conditions.push(sql`jsonb_array_length(${payrollEmployeeRuns.warnings}) > 0`);
    }

    if (options.cursor) {
      conditions.push(sql`${payrollEmployeeRuns.id} > ${options.cursor}`);
    }

    if (options.search) {
      const searchPattern = `%${options.search.trim().toLowerCase()}%`;
      conditions.push(
        sql`(
          lower(${employees.empCode}) LIKE ${searchPattern} OR
          lower(${employees.firstName}) LIKE ${searchPattern} OR
          lower(${employees.lastName}) LIKE ${searchPattern} OR
          lower(${employees.emailWork}) LIKE ${searchPattern}
        )`,
      );
    }

    const rows = await db
      .select({
        id: payrollEmployeeRuns.id,
        employeeId: payrollEmployeeRuns.employeeId,
        empCode: employees.empCode,
        firstName: employees.firstName,
        lastName: employees.lastName,
        emailWork: employees.emailWork,
        status: payrollEmployeeRuns.status,
        holdReason: payrollEmployeeRuns.holdReason,
        gross: payrollEmployeeRuns.gross,
        deductions: payrollEmployeeRuns.deductions,
        employerCost: payrollEmployeeRuns.employerCost,
        net: payrollEmployeeRuns.net,
        blockers: payrollEmployeeRuns.blockers,
        warnings: payrollEmployeeRuns.warnings,
        inputHash: payrollEmployeeRuns.inputHash,
        calcVersion: payrollEmployeeRuns.calcVersion,
      })
      .from(payrollEmployeeRuns)
      .innerJoin(
        employees,
        and(
          eq(employees.companyId, payrollEmployeeRuns.companyId),
          eq(employees.id, payrollEmployeeRuns.employeeId),
        ),
      )
      .where(and(...conditions))
      .orderBy(payrollEmployeeRuns.id)
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1]!.id : null;

    return {
      items: items.map(r => ({
        ...r,
        blockers: (r.blockers as string[]) || [],
        warnings: (r.warnings as string[]) || [],
      })),
      nextCursor,
    };
  }

  /**
   * Set-based SQL comparison between current staged run and previous closed/locked run.
   */
  async getVariance(
    ctx: RequestContext,
    db: Database,
    runId: string,
    options: {
      limit?: number;
      offset?: number;
      thresholdPct?: number;
    } = {},
  ): Promise<{ items: VarianceItem[]; total: number; priorPeriod: string | null }> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_READ) && !ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_REVIEW)) {
      throw new ForbiddenError('Permission denied: payroll.run.read or payroll.run.review required');
    }

    const limit = Math.min(100, Math.max(1, options.limit ?? 50));
    const offset = Math.max(0, options.offset ?? 0);

    // 1. Find current run and period
    const [currentRun] = await db
      .select({
        id: payrollRuns.id,
        periodId: payrollRuns.periodId,
        legalEntityId: payrollPeriods.legalEntityId,
        period: payrollPeriods.period,
      })
      .from(payrollRuns)
      .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.periodId))
      .where(and(eq(payrollRuns.companyId, ctx.companyId), eq(payrollRuns.id, runId)));

    if (!currentRun) {
      throw new NotFoundError('Payroll run not found');
    }

    // 2. Find prior locked/paid/published run for the same legal entity
    const [priorRun] = await db
      .select({
        id: payrollRuns.id,
        period: payrollPeriods.period,
      })
      .from(payrollRuns)
      .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollRuns.periodId))
      .where(
        and(
          eq(payrollRuns.companyId, ctx.companyId),
          eq(payrollPeriods.legalEntityId, currentRun.legalEntityId),
          lt(payrollPeriods.period, currentRun.period),
          inArray(payrollRuns.status, ['locked', 'paid', 'published']),
        ),
      )
      .orderBy(desc(payrollPeriods.period), desc(payrollRuns.sequence))
      .limit(1);

    if (!priorRun) {
      // First payroll run scenario: compare against zero
      const rows = await db
        .select({
          employeeId: payrollEmployeeRuns.employeeId,
          empCode: employees.empCode,
          firstName: employees.firstName,
          lastName: employees.lastName,
          emailWork: employees.emailWork,
          currentStatus: payrollEmployeeRuns.status,
          currentGross: payrollEmployeeRuns.gross,
          currentNet: payrollEmployeeRuns.net,
        })
        .from(payrollEmployeeRuns)
        .innerJoin(
          employees,
          and(
            eq(employees.companyId, payrollEmployeeRuns.companyId),
            eq(employees.id, payrollEmployeeRuns.employeeId),
          ),
        )
        .where(
          and(
            eq(payrollEmployeeRuns.companyId, ctx.companyId),
            eq(payrollEmployeeRuns.runId, runId),
          ),
        )
        .orderBy(desc(payrollEmployeeRuns.gross))
        .limit(limit)
        .offset(offset);

      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(payrollEmployeeRuns)
        .where(
          and(
            eq(payrollEmployeeRuns.companyId, ctx.companyId),
            eq(payrollEmployeeRuns.runId, runId),
          ),
        );

      return {
        priorPeriod: null,
        total: countRow?.count ?? 0,
        items: rows.map(r => ({
          employeeId: r.employeeId,
          empCode: r.empCode,
          firstName: r.firstName,
          lastName: r.lastName,
          emailWork: r.emailWork,
          currentStatus: r.currentStatus,
          currentGross: parseFloat(r.currentGross).toFixed(2),
          currentNet: parseFloat(r.currentNet).toFixed(2),
          priorGross: '0.00',
          priorNet: '0.00',
          grossDiff: parseFloat(r.currentGross).toFixed(2),
          grossPctChange: 100.0,
          varianceCategory: 'FIRST_PAYROLL',
        })),
      };
    }

    // 3. Set-based FULL OUTER JOIN SQL query between current run and prior payslips
    const varianceQuery = sql`
      WITH cur AS (
        SELECT employee_id, status, gross::numeric, net::numeric
        FROM payroll_employee_runs
        WHERE company_id = ${ctx.companyId} AND run_id = ${runId}
      ),
      prev AS (
        SELECT employee_id, gross::numeric, net::numeric
        FROM payslips
        WHERE company_id = ${ctx.companyId} AND run_id = ${priorRun.id}
      ),
      diffed AS (
        SELECT
          COALESCE(cur.employee_id, prev.employee_id) AS employee_id,
          COALESCE(cur.status, 'omitted') AS current_status,
          COALESCE(cur.gross, 0.00) AS cur_gross,
          COALESCE(cur.net, 0.00) AS cur_net,
          COALESCE(prev.gross, 0.00) AS prev_gross,
          COALESCE(prev.net, 0.00) AS prev_net,
          (COALESCE(cur.gross, 0.00) - COALESCE(prev.gross, 0.00)) AS gross_diff,
          CASE
            WHEN COALESCE(prev.gross, 0.00) = 0 THEN 100.00
            ELSE ROUND(((COALESCE(cur.gross, 0.00) - COALESCE(prev.gross, 0.00)) / prev.gross * 100.00), 2)
          END AS gross_pct_change,
          CASE
            WHEN prev.gross IS NULL THEN 'NEW_JOINER'
            WHEN cur.gross IS NULL THEN 'LEAVER_OR_EXCLUDED'
            WHEN ABS(COALESCE(cur.gross, 0.00) - COALESCE(prev.gross, 0.00)) > 0.01 THEN 'VARIANCE'
            ELSE 'UNCHANGED'
          END AS variance_category
        FROM cur
        FULL OUTER JOIN prev ON cur.employee_id = prev.employee_id
      )
      SELECT
        d.employee_id,
        emp.emp_code,
        emp.first_name,
        emp.last_name,
        emp.email_work,
        d.current_status,
        d.cur_gross::text AS cur_gross,
        d.cur_net::text AS cur_net,
        d.prev_gross::text AS prev_gross,
        d.prev_net::text AS prev_net,
        d.gross_diff::text AS gross_diff,
        d.gross_pct_change::float AS gross_pct_change,
        d.variance_category
      FROM diffed d
      LEFT JOIN employees emp ON emp.id = d.employee_id AND emp.company_id = ${ctx.companyId}
      ORDER BY ABS(d.gross_diff) DESC
      LIMIT ${limit} OFFSET ${offset};
    `;

    const countQuery = sql`
      WITH cur AS (
        SELECT employee_id FROM payroll_employee_runs
        WHERE company_id = ${ctx.companyId} AND run_id = ${runId}
      ),
      prev AS (
        SELECT employee_id FROM payslips
        WHERE company_id = ${ctx.companyId} AND run_id = ${priorRun.id}
      )
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT employee_id FROM cur
        UNION
        SELECT employee_id FROM prev
      ) u;
    `;

    const [rows, countRes] = await Promise.all([
      db.execute(varianceQuery),
      db.execute(countQuery),
    ]);

    const total = Number((countRes.rows[0] as { total: number } | undefined)?.total ?? 0);

    const items: VarianceItem[] = (rows.rows as Array<{
      employee_id: string;
      emp_code: string;
      first_name: string;
      last_name: string;
      email_work: string;
      current_status: string;
      cur_gross: string;
      cur_net: string;
      prev_gross: string;
      prev_net: string;
      gross_diff: string;
      gross_pct_change: number;
      variance_category: string;
    }>).map(r => ({
      employeeId: r.employee_id,
      empCode: r.emp_code || '',
      firstName: r.first_name || '',
      lastName: r.last_name || '',
      emailWork: r.email_work || '',
      currentStatus: r.current_status,
      currentGross: parseFloat(r.cur_gross).toFixed(2),
      currentNet: parseFloat(r.cur_net).toFixed(2),
      priorGross: parseFloat(r.prev_gross).toFixed(2),
      priorNet: parseFloat(r.prev_net).toFixed(2),
      grossDiff: parseFloat(r.gross_diff).toFixed(2),
      grossPctChange: r.gross_pct_change,
      varianceCategory: r.variance_category as VarianceItem['varianceCategory'],
    }));

    return {
      priorPeriod: priorRun.period,
      total,
      items,
    };
  }

  /**
   * Places an employee on hold within this payroll run.
   */
  async holdEmployee(
    ctx: RequestContext,
    db: Database,
    runId: string,
    employeeId: string,
    reason: string,
  ): Promise<void> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_HOLD_EMPLOYEE)) {
      throw new ForbiddenError('Permission denied: payroll.run.hold_employee required');
    }

    const run = await this.runRepo.getRunById(db, ctx.companyId, runId);
    if (!run) throw new NotFoundError('Payroll run not found');
    if (['locked', 'closed', 'paid'].includes(run.status)) {
      throw new ValidationError(`Cannot modify employee hold status for run in '${run.status}'`);
    }

    const [staged] = await db
      .select({ id: payrollEmployeeRuns.id })
      .from(payrollEmployeeRuns)
      .where(
        and(
          eq(payrollEmployeeRuns.companyId, ctx.companyId),
          eq(payrollEmployeeRuns.runId, runId),
          eq(payrollEmployeeRuns.employeeId, employeeId),
        ),
      );

    if (!staged) {
      throw new NotFoundError('Employee is not staged in this payroll run');
    }

    await db
      .update(payrollEmployeeRuns)
      .set({
        status: 'held',
        holdReason: reason,
        updatedAt: new Date(),
        updatedBy: ctx.userId ?? 'system',
      })
      .where(
        and(
          eq(payrollEmployeeRuns.companyId, ctx.companyId),
          eq(payrollEmployeeRuns.runId, runId),
          eq(payrollEmployeeRuns.employeeId, employeeId),
        ),
      );

    await db.insert(payrollRunEvents).values({
      companyId: ctx.companyId,
      runId,
      actorId: ctx.userId ?? run.createdBy ?? 'system',
      fromStatus: run.status,
      toStatus: run.status,
      event: 'HOLD_EMPLOYEE',
      details: { action: 'HOLD_EMPLOYEE', employeeId, reason },
    });
  }

  /**
   * Releases an employee from hold, returning status to 'included'.
   */
  async releaseEmployee(
    ctx: RequestContext,
    db: Database,
    runId: string,
    employeeId: string,
  ): Promise<void> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_HOLD_EMPLOYEE)) {
      throw new ForbiddenError('Permission denied: payroll.run.hold_employee required');
    }

    const run = await this.runRepo.getRunById(db, ctx.companyId, runId);
    if (!run) throw new NotFoundError('Payroll run not found');
    if (['locked', 'closed', 'paid'].includes(run.status)) {
      throw new ValidationError(`Cannot modify employee hold status for run in '${run.status}'`);
    }

    const [staged] = await db
      .select({ id: payrollEmployeeRuns.id })
      .from(payrollEmployeeRuns)
      .where(
        and(
          eq(payrollEmployeeRuns.companyId, ctx.companyId),
          eq(payrollEmployeeRuns.runId, runId),
          eq(payrollEmployeeRuns.employeeId, employeeId),
        ),
      );

    if (!staged) {
      throw new NotFoundError('Employee is not staged in this payroll run');
    }

    await db
      .update(payrollEmployeeRuns)
      .set({
        status: 'included',
        holdReason: null,
        updatedAt: new Date(),
        updatedBy: ctx.userId ?? 'system',
      })
      .where(
        and(
          eq(payrollEmployeeRuns.companyId, ctx.companyId),
          eq(payrollEmployeeRuns.runId, runId),
          eq(payrollEmployeeRuns.employeeId, employeeId),
        ),
      );

    await db.insert(payrollRunEvents).values({
      companyId: ctx.companyId,
      runId,
      actorId: ctx.userId ?? run.createdBy ?? 'system',
      fromStatus: run.status,
      toStatus: run.status,
      event: 'RELEASE_EMPLOYEE',
      details: { action: 'RELEASE_EMPLOYEE', employeeId },
    });
  }

  /**
   * Explain-This-Payslip derivation generator.
   * Traverses net -> earnings / deductions lines -> formulas & rules -> dynamic inputs -> attendance.
   */
  async explainPayslip(
    ctx: RequestContext,
    db: Database,
    runId: string,
    employeeId: string,
  ): Promise<{
    employee: {
      id: string;
      empCode: string;
      name: string;
      email: string;
      status: string;
      holdReason: string | null;
    };
    summary: {
      gross: string;
      deductions: string;
      reimbursements: string;
      net: string;
      employerCost: string;
      payableDays: number;
      payableRatio: string;
    };
    lines: {
      earnings: PayslipLineItem[];
      deductions: PayslipLineItem[];
      employerContributions: PayslipLineItem[];
      reimbursements: PayslipLineItem[];
    };
    tdsComputation?: unknown;
    warnings: string[];
    blockers: string[];
    inputHash: string | null;
    calcVersion: number;
  }> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_READ) && !ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_REVIEW)) {
      throw new ForbiddenError('Permission denied: payroll.run.read or payroll.run.review required');
    }

    const [staged] = await db
      .select({
        id: payrollEmployeeRuns.id,
        status: payrollEmployeeRuns.status,
        holdReason: payrollEmployeeRuns.holdReason,
        gross: payrollEmployeeRuns.gross,
        deductions: payrollEmployeeRuns.deductions,
        employerCost: payrollEmployeeRuns.employerCost,
        net: payrollEmployeeRuns.net,
        warnings: payrollEmployeeRuns.warnings,
        blockers: payrollEmployeeRuns.blockers,
        inputHash: payrollEmployeeRuns.inputHash,
        calcVersion: payrollEmployeeRuns.calcVersion,
        result: payrollEmployeeRuns.result,
        empCode: employees.empCode,
        firstName: employees.firstName,
        lastName: employees.lastName,
        emailWork: employees.emailWork,
      })
      .from(payrollEmployeeRuns)
      .innerJoin(
        employees,
        and(
          eq(employees.companyId, payrollEmployeeRuns.companyId),
          eq(employees.id, payrollEmployeeRuns.employeeId),
        ),
      )
      .where(
        and(
          eq(payrollEmployeeRuns.companyId, ctx.companyId),
          eq(payrollEmployeeRuns.runId, runId),
          eq(payrollEmployeeRuns.employeeId, employeeId),
        ),
      );

    if (!staged) {
      throw new NotFoundError('Employee is not found in this payroll run');
    }

    const res = (staged.result as unknown as PayslipCalculationResult) || null;
    const lines = res?.lines || [];

    const earnings = lines.filter(l => l.kind === 'earning');
    const deductions = lines.filter(l => l.kind === 'deduction');
    const employerContributions = lines.filter(l => l.kind === 'employer_contribution');
    const reimbursements = lines.filter(l => l.kind === 'reimbursement');

    return {
      employee: {
        id: employeeId,
        empCode: staged.empCode,
        name: `${staged.firstName} ${staged.lastName}`.trim(),
        email: staged.emailWork,
        status: staged.status,
        holdReason: staged.holdReason,
      },
      summary: {
        gross: res?.gross || staged.gross,
        deductions: res?.deductions || staged.deductions,
        reimbursements: res?.reimbursements || '0.00',
        net: res?.net || staged.net,
        employerCost: res?.employerCost || staged.employerCost,
        payableDays: res?.payableDays ?? 0,
        payableRatio: res?.payableRatio ?? '1.000000',
      },
      lines: {
        earnings,
        deductions,
        employerContributions,
        reimbursements,
      },
      tdsComputation: res?.tdsComputation,
      warnings: (staged.warnings as string[]) || [],
      blockers: (staged.blockers as string[]) || [],
      inputHash: staged.inputHash,
      calcVersion: staged.calcVersion,
    };
  }

  /**
   * Fast simulation of a single employee's payslip without persisting results.
   */
  async simulatePayslip(
    ctx: RequestContext,
    db: Database,
    runId: string,
    employeeId: string,
    overrides?: {
      paidDays?: number;
      lopDays?: number;
      additionalInputs?: Array<{ type: string; componentCode?: string; amount: number }>;
    },
  ): Promise<PayslipCalculationResult> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_READ) && !ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_CALCULATE)) {
      throw new ForbiddenError('Permission denied: payroll.run.read or payroll.run.calculate required');
    }

    const run = await this.runRepo.getRunById(db, ctx.companyId, runId);
    if (!run) throw new NotFoundError('Payroll run not found');

    const period = await this.runRepo.getPeriodById(db, ctx.companyId, run.periodId);
    if (!period) throw new NotFoundError('Payroll period not found');

    // Bulk-load single employee data via bulkLoader
    const loadedData = await this.bulkLoader.loadChunkData(
      db,
      ctx.companyId,
      period.legalEntityId,
      period.period,
      period.fy,
      [employeeId],
    );
    const assembledInput = this.bulkLoader.assemblePayslipInput(
      employeeId,
      period.period,
      loadedData,
      {},
      30,
    );

    if (!assembledInput) {
      throw new NotFoundError('Employee payslip input could not be assembled');
    }

    // Apply simulation overrides if present
    if (overrides) {
      if (overrides.paidDays !== undefined) {
        assembledInput.attendance.paidDays = overrides.paidDays;
      }
      if (overrides.lopDays !== undefined) {
        assembledInput.attendance.lopDays = overrides.lopDays;
      }
      if (overrides.additionalInputs && overrides.additionalInputs.length > 0) {
        for (const add of overrides.additionalInputs) {
          assembledInput.inputs.push({
            type: add.type,
            componentCode: add.componentCode,
            amount: add.amount,
          });
        }
      }
    }

    return computePayslip(assembledInput);
  }
}
