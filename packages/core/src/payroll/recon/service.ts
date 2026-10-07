import { and, eq } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import {
  Database,
  reconCycles,
  reconImports,
  reconDiffs,
  payrollRuns,
  payslips,
  payslipLines,
  employees,
  ReconCycle,
  ReconDiff,
} from '@hrms/db';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../../routing/context.js';

export interface CreateReconCycleDTO {
  period: string; // 'YYYY-MM'
  runId: string;
  tolerance?: number | string;
}

export interface ImportLegacyDataDTO {
  filename: string;
  columnMapping: Record<string, string>; // e.g. { "Basic Salary": "BASIC", "HRA": "HRA", "Net Pay": "NET" }
  rows: Array<Record<string, unknown>>;  // e.g. [{ empCode: "EMP001", "Basic Salary": 50000, "Net Pay": 42000 }]
}

export interface ExplainDiffDTO {
  explanation: string;
  category?: 'rounding' | 'rule_difference' | 'input_difference' | 'engine_bug' | 'source_error' | 'timing';
  status?: 'explained' | 'accepted' | 'fixed';
}

export class ReconciliationService {
  /**
   * Initializes a parallel run reconciliation cycle.
   */
  async createCycle(
    ctx: RequestContext,
    db: Database,
    dto: CreateReconCycleDTO,
  ): Promise<ReconCycle> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RECON_MANAGE)) {
      throw new ForbiddenError('Permission denied: payroll.recon.manage required');
    }

    const [run] = await db
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.companyId, ctx.companyId), eq(payrollRuns.id, dto.runId)));

    if (!run) throw new NotFoundError('Target payroll run not found');

    const tolerance = new Decimal(dto.tolerance ?? 1.0).toFixed(2);

    const [cycle] = await db
      .insert(reconCycles)
      .values({
        companyId: ctx.companyId,
        period: dto.period,
        runId: dto.runId,
        tolerance,
        status: 'open',
        summary: {
          totalCompared: 0,
          matchingPercentage: '0.00',
          totalVariance: '0.00',
          openDiffs: 0,
          explainedDiffs: 0,
        },
        createdBy: ctx.userId || null,
        updatedBy: ctx.userId || null,
      })
      .returning();

    if (!cycle) throw new Error('Failed to create recon cycle');
    return cycle;
  }

  /**
   * Imports legacy payroll run output and compares against our run's payslip lines.
   */
  async importAndCompare(
    ctx: RequestContext,
    db: Database,
    cycleId: string,
    dto: ImportLegacyDataDTO,
  ): Promise<{ importId: string; comparedEmployees: number; totalDiffsCount: number; summary: Record<string, unknown> }> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RECON_MANAGE)) {
      throw new ForbiddenError('Permission denied: payroll.recon.manage required');
    }

    const [cycle] = await db
      .select()
      .from(reconCycles)
      .where(and(eq(reconCycles.companyId, ctx.companyId), eq(reconCycles.id, cycleId)));

    if (!cycle) throw new NotFoundError('Reconciliation cycle not found');
    if (cycle.status === 'signed') {
      throw new ValidationError('Cannot import data into a signed reconciliation cycle');
    }

    const toleranceDec = new Decimal(cycle.tolerance);

    // Record import record
    const [reconImport] = await db
      .insert(reconImports)
      .values({
        companyId: ctx.companyId,
        cycleId: cycle.id,
        filename: dto.filename,
        columnMapping: dto.columnMapping,
        rowCount: dto.rows.length,
        createdBy: ctx.userId || null,
      })
      .returning();

    if (!reconImport) throw new Error('Failed to record recon import');

    // Fetch our payslips & lines for the cycle's run
    const slipRows = await db
      .select({
        slip: payslips,
        line: payslipLines,
        emp: employees,
      })
      .from(payslips)
      .innerJoin(employees, eq(payslips.employeeId, employees.id))
      .leftJoin(payslipLines, eq(payslipLines.payslipId, payslips.id))
      .where(and(eq(payslips.companyId, ctx.companyId), eq(payslips.runId, cycle.runId)));

    // Group our lines by employee number and component code
    const ourLinesByEmpCode = new Map<string, { employeeId: string; components: Map<string, Decimal> }>();

    for (const { slip, line, emp } of slipRows) {
      const code = emp.empCode;
      if (!code) continue;

      let empEntry = ourLinesByEmpCode.get(code);
      if (!empEntry) {
        empEntry = { employeeId: emp.id, components: new Map() };
        // Store net pay
        empEntry.components.set('NET', new Decimal(slip.net));
        empEntry.components.set('GROSS', new Decimal(slip.gross));
        empEntry.components.set('DEDUCTIONS', new Decimal(slip.deductions));
        ourLinesByEmpCode.set(code, empEntry);
      }

      if (line) {
        empEntry.components.set(line.componentCode, new Decimal(line.amount));
      }
    }

    let comparedCount = 0;
    let totalComparisons = 0;
    let exactMatches = 0;
    let totalVariance = new Decimal(0);
    let openDiffsCount = 0;
    let explainedDiffsCount = 0;

    for (const legacyRow of dto.rows) {
      const empCode = (legacyRow.empCode || legacyRow.employeeCode || legacyRow['Employee Code']) as string;
      if (!empCode) continue;

      const ourData = ourLinesByEmpCode.get(empCode.trim());
      if (!ourData) continue;

      comparedCount += 1;

      for (const [legacyCol, ourCode] of Object.entries(dto.columnMapping)) {
        if (!(legacyCol in legacyRow)) continue;

        const legacyValStr = legacyRow[legacyCol];
        if (legacyValStr === undefined || legacyValStr === null) continue;

        totalComparisons += 1;
        const legacyAmt = new Decimal(String(legacyValStr).replace(/,/g, '') || 0);
        const ourAmt = ourData.components.get(ourCode) || new Decimal(0);
        const diff = ourAmt.minus(legacyAmt);

        if (diff.isZero()) {
          exactMatches += 1;
          continue;
        }

        const absDiff = diff.abs();
        totalVariance = totalVariance.plus(absDiff);

        let category: 'rounding' | 'rule_difference' | 'input_difference' | 'engine_bug' | 'source_error' | 'timing' = 'rounding';
        let status: 'open' | 'explained' | 'accepted' | 'fixed' = 'open';
        let explanation: string | null = null;

        if (absDiff.lessThanOrEqualTo(toleranceDec)) {
          category = 'rounding';
          status = 'accepted';
          explanation = `Variance ${diff.toFixed(2)} is within agreed tolerance of ₹${toleranceDec.toFixed(2)}`;
          explainedDiffsCount += 1;
        } else {
          openDiffsCount += 1;
          if (['EPF', 'EPS', 'ESI', 'PT', 'TDS'].includes(ourCode)) {
            category = 'rule_difference';
            explanation = `Statutory rule difference under evaluation for ${ourCode}`;
          } else {
            category = 'input_difference';
            explanation = `Component variance observed: ours ₹${ourAmt.toFixed(2)} vs legacy ₹${legacyAmt.toFixed(2)}`;
          }
        }

        await db
          .insert(reconDiffs)
          .values({
            companyId: ctx.companyId,
            cycleId: cycle.id,
            employeeId: ourData.employeeId,
            componentCode: ourCode,
            oursAmount: ourAmt.toFixed(2),
            theirsAmount: legacyAmt.toFixed(2),
            diff: diff.toFixed(2),
            category,
            status,
            explanation,
          })
          .onConflictDoNothing();
      }
    }

    const matchPct = totalComparisons > 0 ? new Decimal(exactMatches).div(totalComparisons).mul(100).toFixed(2) : '100.00';

    const summary = {
      totalEmployeesCompared: comparedCount,
      totalComparisons,
      exactMatches,
      matchingPercentage: matchPct,
      totalVariance: totalVariance.toFixed(2),
      openDiffs: openDiffsCount,
      explainedDiffs: explainedDiffsCount,
    };

    await db
      .update(reconCycles)
      .set({
        summary,
        status: 'in_review',
        updatedAt: new Date(),
        updatedBy: ctx.userId || null,
      })
      .where(and(eq(reconCycles.companyId, ctx.companyId), eq(reconCycles.id, cycle.id)));

    return {
      importId: reconImport.id,
      comparedEmployees: comparedCount,
      totalDiffsCount: openDiffsCount + explainedDiffsCount,
      summary,
    };
  }

  /**
   * Finance / CA adds explanation to a variance item.
   */
  async explainDiff(
    ctx: RequestContext,
    db: Database,
    diffId: string,
    dto: ExplainDiffDTO,
  ): Promise<ReconDiff> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RECON_MANAGE)) {
      throw new ForbiddenError('Permission denied: payroll.recon.manage required');
    }

    const [updated] = await db
      .update(reconDiffs)
      .set({
        explanation: dto.explanation,
        category: dto.category ?? 'rounding',
        status: dto.status ?? 'explained',
        explainedBy: ctx.userId || null,
        explainedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(reconDiffs.companyId, ctx.companyId), eq(reconDiffs.id, diffId)))
      .returning();

    if (!updated) throw new NotFoundError('Reconciliation variance record not found');
    return updated;
  }

  /**
   * Dual sign-off workflow: Requires independent signatures by CA and Finance Lead.
   */
  async signoffCycle(
    ctx: RequestContext,
    db: Database,
    cycleId: string,
    role: 'ca' | 'finance',
  ): Promise<ReconCycle> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RECON_SIGNOFF)) {
      throw new ForbiddenError('Permission denied: payroll.recon.signoff required');
    }

    const [cycle] = await db
      .select()
      .from(reconCycles)
      .where(and(eq(reconCycles.companyId, ctx.companyId), eq(reconCycles.id, cycleId)));

    if (!cycle) throw new NotFoundError('Reconciliation cycle not found');

    // Verify all diffs are explained or accepted
    const openDiffs = await db
      .select()
      .from(reconDiffs)
      .where(
        and(
          eq(reconDiffs.companyId, ctx.companyId),
          eq(reconDiffs.cycleId, cycleId),
          eq(reconDiffs.status, 'open'),
        ),
      );

    if (openDiffs.length > 0) {
      throw new ValidationError(`Cannot sign off: There are ${openDiffs.length} unexplained variances`);
    }

    const now = new Date();
    const updateData: Partial<ReconCycle> = {
      updatedAt: now,
      updatedBy: ctx.userId || null,
    };

    if (role === 'ca') {
      updateData.signedByCa = ctx.userId || null;
      updateData.signedByCaAt = now;
    } else {
      updateData.signedByFinance = ctx.userId || null;
      updateData.signedByFinanceAt = now;
    }

    // If both signatures exist, mark cycle as signed
    const willBeSigned =
      (role === 'ca' && cycle.signedByFinance) ||
      (role === 'finance' && cycle.signedByCa);

    if (willBeSigned) {
      updateData.status = 'signed';
    }

    const [updated] = await db
      .update(reconCycles)
      .set(updateData)
      .where(and(eq(reconCycles.companyId, ctx.companyId), eq(reconCycles.id, cycleId)))
      .returning();

    if (!updated) throw new NotFoundError('Reconciliation cycle not found');
    return updated;
  }

  /**
   * Retrieves diffs for a reconciliation cycle.
   */
  async getCycleDiffs(
    ctx: RequestContext,
    db: Database,
    cycleId: string,
  ): Promise<ReconDiff[]> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RECON_MANAGE)) {
      throw new ForbiddenError('Permission denied: payroll.recon.manage required');
    }

    return db
      .select()
      .from(reconDiffs)
      .where(and(eq(reconDiffs.companyId, ctx.companyId), eq(reconDiffs.cycleId, cycleId)));
  }
}
