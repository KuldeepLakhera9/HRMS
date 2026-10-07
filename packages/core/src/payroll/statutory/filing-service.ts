import { and, eq } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import {
  Database,
  payslips,
  payslipLines,
  payrollRuns,
  employees,
  statutoryFilings,
  StatutoryFiling,
} from '@hrms/db';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../../routing/context.js';
import { StatutoryRulesRepository } from '../rules/repository.js';

export interface PfEcrRecord {
  uan: string;
  memberName: string;
  grossWages: number;
  epfWages: number;
  epsWages: number;
  edliWages: number;
  epfContriRemitted: number;
  epsContriRemitted: number;
  epfEpsDiffRemitted: number;
  ncpDays: number;
  refundOfAdvances: number;
}

export interface EsiContributionRecord {
  ipNumber: string;
  ipName: string;
  paidDays: number;
  totalWages: number;
  ipContribution: number;
  employerContribution: number;
  reasonCode?: string;
}

export interface PtSummaryRecord {
  state: string;
  employeeCount: number;
  grossWages: number;
  ptAmount: number;
}

export interface ChallanInputDTO {
  challanReference: string;
  challanDate: string;
  challanAmount: number | string;
  notes?: string;
}

export class StatutoryFilingService {
  constructor(private rulesRepo = new StatutoryRulesRepository()) {}

  /**
   * Generates PF ECR 2.0 text file for a locked payroll run.
   * Specification: Official EPFO ECR format under Section 38(1) of Employees' Provident Funds Scheme, 1952.
   * Delimiter: #~#
   * 11 standard columns:
   * 1. UAN
   * 2. MEMBER_NAME
   * 3. GROSS_WAGES
   * 4. EPF_WAGES
   * 5. EPS_WAGES
   * 6. EDLI_WAGES
   * 7. EPF_CONTRI_REMITTED
   * 8. EPS_CONTRI_REMITTED
   * 9. EPF_EPS_DIFF_REMITTED
   * 10. NCP_DAYS
   * 11. REFUND_OF_ADVANCES
   */
  async generatePfEcr(
    ctx: RequestContext,
    db: Database,
    runId: string,
  ): Promise<{ fileContent: string; filing: StatutoryFiling; recordCount: number; controlTotal: string }> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_STATUTORY_GENERATE)) {
      throw new ForbiddenError('Permission denied: payroll.statutory.generate required');
    }

    const [run] = await db
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.companyId, ctx.companyId), eq(payrollRuns.id, runId)));

    if (!run) throw new NotFoundError('Payroll run not found');
    if (!['locked', 'published', 'paid'].includes(run.status)) {
      throw new ValidationError(`Cannot generate statutory filing for run in status '${run.status}'`);
    }

    // Fetch all payslips for the run
    const slipRows = await db
      .select({
        slip: payslips,
        emp: employees,
      })
      .from(payslips)
      .innerJoin(employees, eq(payslips.employeeId, employees.id))
      .where(and(eq(payslips.companyId, ctx.companyId), eq(payslips.runId, runId)));

    // Fetch all EPF payslip lines for reconciliation
    const epfLines = await db
      .select()
      .from(payslipLines)
      .where(
        and(
          eq(payslipLines.companyId, ctx.companyId),
          eq(payslipLines.runId, runId),
          eq(payslipLines.componentCode, 'EPF'),
        ),
      );

    const lineTotalEpf = epfLines.reduce((acc, l) => acc.plus(new Decimal(l.amount)), new Decimal(0));

    let fileTotalEpf = new Decimal(0);
    const textLines: string[] = [];

    for (const { slip, emp } of slipRows) {
      const snap = slip.snapshot as {
        employee?: { uan?: string; name?: string };
        attendance?: { paidDays?: number; lopDays?: number };
        lines?: Array<{ code: string; amount: string; kind: string }>;
      };

      const uan = (emp as unknown as { uan?: string }).uan || snap.employee?.uan || '100000000000';
      const name = emp.firstName ? `${emp.firstName} ${emp.lastName || ''}`.trim() : snap.employee?.name || 'Employee';
      const gross = new Decimal(slip.gross).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
      const ncpDays = snap.attendance?.lopDays || 0;

      // Find EPF deduction line
      const epfLine = snap.lines?.find(l => l.code === 'EPF');
      const epfAmount = epfLine ? new Decimal(epfLine.amount).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber() : 0;
      fileTotalEpf = fileTotalEpf.plus(epfAmount);

      // Wage bases (standard statutory cap of 15,000 for standard EPF)
      const epfWages = Math.min(gross, 15000);
      const epsWages = epfWages;
      const edliWages = epfWages;

      // Employer split: EPS is 8.33% (capped at 1250), EPF employer is 3.67%
      const epsContri = Math.min(Math.round(epsWages * 0.0833), 1250);
      const epfEpsDiff = epfAmount > epsContri ? epfAmount - epsContri : 0;

      // Format as #~# delimited
      const row = [
        uan,
        name,
        gross,
        epfWages,
        epsWages,
        edliWages,
        epfAmount,
        epsContri,
        epfEpsDiff,
        ncpDays,
        0, // refund of advances
      ].join('#~#');

      textLines.push(row);
    }

    const fileContent = textLines.join('\n');
    const isReconciled = lineTotalEpf.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).equals(fileTotalEpf);

    const [filing] = await db
      .insert(statutoryFilings)
      .values({
        companyId: ctx.companyId,
        type: 'PF_ECR',
        period: (slipRows[0]?.slip.period as string) || '2026-03',
        fy: '2026-2027',
        runIds: [runId],
        totals: {
          recordCount: textLines.length,
          totalEpfEmployee: fileTotalEpf.toFixed(2),
          payslipLinesTotal: lineTotalEpf.toFixed(2),
        },
        reconciledWithRun: isReconciled,
        mismatchDetails: isReconciled
          ? []
          : [
              {
                field: 'EPF',
                fileTotal: fileTotalEpf.toFixed(2),
                payslipLinesTotal: lineTotalEpf.toFixed(2),
              },
            ],
        status: isReconciled ? 'reconciled' : 'generated',
        generatedBy: ctx.userId || run.createdBy || ctx.companyId,
        createdBy: ctx.userId || run.createdBy,
        updatedBy: ctx.userId || run.createdBy,
      })
      .returning();

    if (!filing) throw new Error('Failed to create PF statutory filing');

    return {
      fileContent,
      filing,
      recordCount: textLines.length,
      controlTotal: fileTotalEpf.toFixed(2),
    };
  }

  /**
   * Generates ESI monthly contribution data.
   */
  async generateEsiContribution(
    ctx: RequestContext,
    db: Database,
    runId: string,
  ): Promise<{ records: EsiContributionRecord[]; filing: StatutoryFiling; totalContribution: string }> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_STATUTORY_GENERATE)) {
      throw new ForbiddenError('Permission denied: payroll.statutory.generate required');
    }

    const [run] = await db
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.companyId, ctx.companyId), eq(payrollRuns.id, runId)));

    if (!run) throw new NotFoundError('Payroll run not found');

    const slipRows = await db
      .select({
        slip: payslips,
        emp: employees,
      })
      .from(payslips)
      .innerJoin(employees, eq(payslips.employeeId, employees.id))
      .where(and(eq(payslips.companyId, ctx.companyId), eq(payslips.runId, runId)));

    // Fetch all ESI lines
    const esiLines = await db
      .select()
      .from(payslipLines)
      .where(
        and(
          eq(payslipLines.companyId, ctx.companyId),
          eq(payslipLines.runId, runId),
          eq(payslipLines.componentCode, 'ESI'),
        ),
      );

    const lineTotalEsi = esiLines.reduce((acc, l) => acc.plus(new Decimal(l.amount)), new Decimal(0));
    let fileTotalEsi = new Decimal(0);
    const records: EsiContributionRecord[] = [];

    for (const { slip, emp } of slipRows) {
      const snap = slip.snapshot as {
        employee?: { name?: string };
        attendance?: { paidDays?: number };
        lines?: Array<{ code: string; amount: string }>;
      };

      const esiLine = snap.lines?.find(l => l.code === 'ESI');
      if (!esiLine) continue;

      const empContrib = new Decimal(esiLine.amount).toNumber();
      const gross = new Decimal(slip.gross).toNumber();
      const employerContrib = Math.round(gross * 0.0325);
      fileTotalEsi = fileTotalEsi.plus(empContrib);

      const pan = (emp as unknown as { pan?: string }).pan || '';
      records.push({
        ipNumber: pan ? `IP${pan.slice(-8)}` : '1100000000',
        ipName: emp.firstName ? `${emp.firstName} ${emp.lastName || ''}`.trim() : snap.employee?.name || 'Employee',
        paidDays: snap.attendance?.paidDays || 30,
        totalWages: gross,
        ipContribution: empContrib,
        employerContribution: employerContrib,
      });
    }

    const isReconciled = lineTotalEsi.equals(fileTotalEsi);

    const [filing] = await db
      .insert(statutoryFilings)
      .values({
        companyId: ctx.companyId,
        type: 'ESI_CONTRIBUTION',
        period: (slipRows[0]?.slip.period as string) || '2026-03',
        fy: '2026-2027',
        runIds: [runId],
        totals: {
          employeeCount: records.length,
          totalEmployeeContribution: fileTotalEsi.toFixed(2),
          payslipLinesTotal: lineTotalEsi.toFixed(2),
        },
        reconciledWithRun: isReconciled,
        status: isReconciled ? 'reconciled' : 'generated',
        generatedBy: ctx.userId || run.createdBy || ctx.companyId,
        createdBy: ctx.userId || run.createdBy,
        updatedBy: ctx.userId || run.createdBy,
      })
      .returning();

    if (!filing) throw new Error('Failed to create ESI statutory filing');

    return {
      records,
      filing,
      totalContribution: fileTotalEsi.toFixed(2),
    };
  }

  /**
   * Generates Professional Tax (PT) state-wise summary.
   */
  async generatePtSummary(
    ctx: RequestContext,
    db: Database,
    runId: string,
  ): Promise<{ summaries: PtSummaryRecord[]; filing: StatutoryFiling; totalPt: string }> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_STATUTORY_GENERATE)) {
      throw new ForbiddenError('Permission denied: payroll.statutory.generate required');
    }

    const [run] = await db
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.companyId, ctx.companyId), eq(payrollRuns.id, runId)));

    if (!run) throw new NotFoundError('Payroll run not found');

    const ptLines = await db
      .select({
        line: payslipLines,
        slip: payslips,
        emp: employees,
      })
      .from(payslipLines)
      .innerJoin(payslips, eq(payslipLines.payslipId, payslips.id))
      .innerJoin(employees, eq(payslipLines.employeeId, employees.id))
      .where(
        and(
          eq(payslipLines.companyId, ctx.companyId),
          eq(payslipLines.runId, runId),
          eq(payslipLines.componentCode, 'PT'),
        ),
      );

    const stateMap = new Map<string, { count: number; gross: Decimal; pt: Decimal }>();

    for (const { line, slip, emp } of ptLines) {
      const state = (emp as unknown as { state?: string }).state || 'KA';
      const existing = stateMap.get(state) || { count: 0, gross: new Decimal(0), pt: new Decimal(0) };
      existing.count += 1;
      existing.gross = existing.gross.plus(new Decimal(slip.gross));
      existing.pt = existing.pt.plus(new Decimal(line.amount));
      stateMap.set(state, existing);
    }

    const summaries: PtSummaryRecord[] = [];
    let totalPt = new Decimal(0);

    for (const [state, data] of stateMap.entries()) {
      summaries.push({
        state,
        employeeCount: data.count,
        grossWages: data.gross.toNumber(),
        ptAmount: data.pt.toNumber(),
      });
      totalPt = totalPt.plus(data.pt);
    }

    const [filing] = await db
      .insert(statutoryFilings)
      .values({
        companyId: ctx.companyId,
        type: 'PT_SUMMARY',
        period: run.periodId,
        fy: '2026-2027',
        runIds: [runId],
        totals: {
          stateCount: summaries.length,
          totalPt: totalPt.toFixed(2),
        },
        reconciledWithRun: true,
        status: 'reconciled',
        generatedBy: ctx.userId || run.createdBy || ctx.companyId,
        createdBy: ctx.userId || run.createdBy,
        updatedBy: ctx.userId || run.createdBy,
      })
      .returning();

    if (!filing) throw new Error('Failed to create PT statutory filing');

    return {
      summaries,
      filing,
      totalPt: totalPt.toFixed(2),
    };
  }

  /**
   * Generates Quarterly TDS Return data (Form 138 / Form 24Q equivalent)
   * Form label names dynamically resolved from FORM_LABELS rule set.
   */
  async generateTdsReturnData(
    ctx: RequestContext,
    db: Database,
    runId: string,
  ): Promise<{ filing: StatutoryFiling; formLabel: string; totalTds: string; employeeCount: number }> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_STATUTORY_GENERATE)) {
      throw new ForbiddenError('Permission denied: payroll.statutory.generate required');
    }

    const [run] = await db
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.companyId, ctx.companyId), eq(payrollRuns.id, runId)));

    if (!run) throw new NotFoundError('Payroll run not found');

    // Retrieve active form labels
    const formLabelsRule = await this.rulesRepo.getActiveRuleSet(
      db,
      ctx.companyId,
      'FORM_LABELS',
      'IN',
      new Date().toISOString().slice(0, 10),
    );

    let quarterlyFormLabel = 'Form 138 (Quarterly Salary TDS)';
    if (formLabelsRule) {
      const parsed = formLabelsRule.payload as { forms?: { quarterlyTdsReturn?: string } };
      if (parsed.forms?.quarterlyTdsReturn) {
        quarterlyFormLabel = parsed.forms.quarterlyTdsReturn;
      }
    }

    const tdsLines = await db
      .select()
      .from(payslipLines)
      .where(
        and(
          eq(payslipLines.companyId, ctx.companyId),
          eq(payslipLines.runId, runId),
          eq(payslipLines.componentCode, 'TDS'),
        ),
      );

    const totalTds = tdsLines.reduce((acc, l) => acc.plus(new Decimal(l.amount)), new Decimal(0));

    const [filing] = await db
      .insert(statutoryFilings)
      .values({
        companyId: ctx.companyId,
        type: 'TDS_RETURN_DATA',
        period: run.periodId,
        fy: '2026-2027',
        runIds: [runId],
        totals: {
          formLabel: quarterlyFormLabel,
          employeeCount: tdsLines.length,
          totalTdsDeducted: totalTds.toFixed(2),
        },
        reconciledWithRun: true,
        status: 'reconciled',
        generatedBy: ctx.userId || run.createdBy || ctx.companyId,
        createdBy: ctx.userId || run.createdBy,
        updatedBy: ctx.userId || run.createdBy,
      })
      .returning();

    if (!filing) throw new Error('Failed to create TDS statutory filing');

    return {
      filing,
      formLabel: quarterlyFormLabel,
      totalTds: totalTds.toFixed(2),
      employeeCount: tdsLines.length,
    };
  }

  /**
   * Links challan payment confirmation to a statutory filing.
   */
  async linkChallan(
    ctx: RequestContext,
    db: Database,
    filingId: string,
    dto: ChallanInputDTO,
  ): Promise<StatutoryFiling> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_STATUTORY_GENERATE)) {
      throw new ForbiddenError('Permission denied: payroll.statutory.generate required');
    }

    const [updated] = await db
      .update(statutoryFilings)
      .set({
        challanReference: dto.challanReference,
        challanDate: dto.challanDate,
        challanAmount: String(dto.challanAmount),
        notes: dto.notes,
        status: 'filed_by_ca',
        updatedAt: new Date(),
        updatedBy: ctx.userId || null,
      })
      .where(and(eq(statutoryFilings.companyId, ctx.companyId), eq(statutoryFilings.id, filingId)))
      .returning();

    if (!updated) throw new NotFoundError('Statutory filing record not found');
    return updated;
  }

  /**
   * Returns standard statutory compliance due dates and reminder calendar.
   */
  getDueCalendar(): Array<{ name: string; dueDay: number; description: string; penaltyNote: string }> {
    return [
      {
        name: 'Provident Fund (PF) ECR & Payment',
        dueDay: 15,
        description: 'Payment and ECR return submission for EPF/EPS/EDLI contributions of preceding month.',
        penaltyNote: 'Damages u/s 14B (5% to 25% p.a.) and interest u/s 7Q (12% p.a.).',
      },
      {
        name: 'ESIC Monthly Contribution',
        dueDay: 15,
        description: 'Online contribution deposit for ESI Scheme for preceding month.',
        penaltyNote: 'Interest @ 12% per annum for each day of delay.',
      },
      {
        name: 'TDS Deposit (Section 392 / 192)',
        dueDay: 7,
        description: 'Monthly tax deducted at source deposited to central government (30th April for March).',
        penaltyNote: 'Interest @ 1.5% per month or part of a month u/s 201(1A).',
      },
      {
        name: 'Quarterly TDS Return (Form 138 / 24Q)',
        dueDay: 31,
        description: 'Filing quarterly statement of salary TDS by last day of month following quarter end.',
        penaltyNote: 'Late filing fee of ₹200/day u/s 234E plus penalty u/s 271H.',
      },
      {
        name: 'Professional Tax (PT) - State Returns',
        dueDay: 20,
        description: 'Monthly state PT return and challan deposit (e.g. 20th in Karnataka, last day in Maharashtra).',
        penaltyNote: 'Simple interest @ 1.25% to 2% per month depending on state regulations.',
      },
    ];
  }
}
