import { Decimal } from 'decimal.js';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  Database,
  employeeLoans,
  loanInstallments,
  payrollInputs,
  EmployeeLoan,
  NewEmployeeLoan,
  LoanInstallment,
  NewLoanInstallment,
  NewPayrollInput,
} from '@hrms/db';
import {
  ForbiddenError,
  ValidationError,
  UnauthorizedError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../../routing/context.js';

export interface CreateLoanDto {
  employeeId: string;
  type?: 'loan' | 'advance';
  principal: string | number;
  interestRate?: string | number; // annual percentage, default 0
  installmentsCount: number;
  startPeriod: string; // 'YYYY-MM'
}

export class LoanService {
  /**
   * Helper to advance a period 'YYYY-MM' by N months.
   */
  static addMonthsToPeriod(period: string, monthsToAdd: number): string {
    const parts = period.split('-');
    const year = Number(parts[0]) || 0;
    const month = Number(parts[1]) || 1;
    const totalMonths = (year * 12) + (month - 1) + monthsToAdd;
    const newYear = Math.floor(totalMonths / 12);
    const newMonth = (totalMonths % 12) + 1;
    return `${newYear}-${String(newMonth).padStart(2, '0')}`;
  }

  /**
   * Creates a loan or salary advance with an automated installment repayment schedule.
   */
  async createLoan(
    ctx: RequestContext,
    db: Database,
    dto: CreateLoanDto,
  ): Promise<{ loan: EmployeeLoan; installments: LoanInstallment[] }> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_LOAN_MANAGE)) {
      throw new ForbiddenError('Permission denied: payroll.loan.manage required');
    }
    const userId = ctx.userId;
    if (!userId) {
      throw new UnauthorizedError('User authentication required');
    }

    const principalDec = new Decimal(dto.principal);
    if (principalDec.lessThanOrEqualTo(0)) {
      throw new ValidationError('Loan principal must be greater than zero');
    }
    if (dto.installmentsCount <= 0) {
      throw new ValidationError('Installments count must be at least 1');
    }

    const count = dto.installmentsCount;
    const interestRateDec = new Decimal(dto.interestRate || 0);

    // Calculate monthly EMI installment
    let monthlyEmi: Decimal;
    let monthlyPrincipal: Decimal;
    let monthlyInterest: Decimal;

    if (interestRateDec.isZero()) {
      monthlyPrincipal = principalDec.div(count).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      monthlyInterest = new Decimal(0);
      monthlyEmi = monthlyPrincipal;
    } else {
      // Flat monthly interest calculation for simplicity & transparency
      const totalInterest = principalDec.mul(interestRateDec.div(100)).mul(new Decimal(count).div(12));
      monthlyPrincipal = principalDec.div(count).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      monthlyInterest = totalInterest.div(count).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      monthlyEmi = monthlyPrincipal.plus(monthlyInterest);
    }

    const loanInsert: NewEmployeeLoan = {
      companyId: ctx.companyId,
      employeeId: dto.employeeId,
      type: dto.type || 'loan',
      principal: principalDec.toFixed(2),
      interestRate: interestRateDec.toFixed(2),
      installmentsCount: count,
      emiAmount: monthlyEmi.toFixed(2),
      startPeriod: dto.startPeriod,
      status: 'active',
      createdBy: userId,
      updatedBy: userId,
    };

    const [createdLoan] = await db.insert(employeeLoans).values(loanInsert).returning();
    if (!createdLoan) throw new Error('Failed to create employee loan');

    // Generate installment rows
    const installmentInserts: NewLoanInstallment[] = [];
    let principalRunningTotal = new Decimal(0);

    for (let i = 1; i <= count; i++) {
      const duePeriod = LoanService.addMonthsToPeriod(dto.startPeriod, i - 1);

      // Handle penny rounding difference on the final installment
      let curPrincipal = monthlyPrincipal;
      if (i === count) {
        curPrincipal = principalDec.minus(principalRunningTotal);
      } else {
        principalRunningTotal = principalRunningTotal.plus(curPrincipal);
      }
      const totalAmount = curPrincipal.plus(monthlyInterest);

      installmentInserts.push({
        companyId: ctx.companyId,
        loanId: createdLoan.id,
        installmentNumber: i,
        duePeriod,
        principalComponent: curPrincipal.toFixed(2),
        interestComponent: monthlyInterest.toFixed(2),
        totalAmount: totalAmount.toFixed(2),
        status: 'due',
        createdBy: userId,
        updatedBy: userId,
      });
    }

    const createdInstallments = await db.insert(loanInstallments).values(installmentInserts).returning();

    return {
      loan: createdLoan,
      installments: createdInstallments,
    };
  }

  /**
   * Lists employee loans/advances for the tenant with optional employee and status filters.
   * Permission: payroll.loan.read.
   */
  async listLoans(
    ctx: RequestContext,
    db: Database,
    query: { employeeId?: string; status?: 'active' | 'cancelled' | 'completed' | 'paused' } = {},
  ): Promise<EmployeeLoan[]> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_LOAN_READ)) {
      throw new ForbiddenError('Permission denied: payroll.loan.read required');
    }

    const conditions = [
      eq(employeeLoans.companyId, ctx.companyId),
      isNull(employeeLoans.deletedAt),
    ];

    if (query.employeeId) {
      conditions.push(eq(employeeLoans.employeeId, query.employeeId));
    }
    if (query.status) {
      conditions.push(eq(employeeLoans.status, query.status));
    }

    return db
      .select()
      .from(employeeLoans)
      .where(and(...conditions))
      .orderBy(desc(employeeLoans.createdAt));
  }

  /**
   * Generates payroll inputs for due loan installments for the specified payroll period.
   * Completely idempotent via source key unique constraint.
   */
  async generateEmiInputsForPeriod(
    ctx: RequestContext,
    db: Database,
    period: string, // 'YYYY-MM'
  ): Promise<{ inputsGenerated: number }> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_INPUT_CREATE) && !ctx.permissions?.includes(PERMISSIONS.PAYROLL_LOAN_MANAGE)) {
      throw new ForbiddenError('Permission denied: payroll.loan.manage or input.create required');
    }

    const userId = ctx.userId;
    if (!userId) {
      throw new UnauthorizedError('User authentication required');
    }

    // Find due installments for this period
    const dueInstallments = await db
      .select({
        installmentId: loanInstallments.id,
        loanId: loanInstallments.loanId,
        employeeId: employeeLoans.employeeId,
        totalAmount: loanInstallments.totalAmount,
        installmentNumber: loanInstallments.installmentNumber,
      })
      .from(loanInstallments)
      .innerJoin(
        employeeLoans,
        and(
          eq(loanInstallments.companyId, employeeLoans.companyId),
          eq(loanInstallments.loanId, employeeLoans.id),
        ),
      )
      .where(
        and(
          eq(loanInstallments.companyId, ctx.companyId),
          eq(loanInstallments.duePeriod, period),
          eq(loanInstallments.status, 'due'),
          eq(employeeLoans.status, 'active'),
          isNull(loanInstallments.deletedAt),
          isNull(employeeLoans.deletedAt),
        ),
      );

    if (dueInstallments.length === 0) {
      return { inputsGenerated: 0 };
    }

    const inputRecords: NewPayrollInput[] = dueInstallments.map(inst => ({
      companyId: ctx.companyId,
      employeeId: inst.employeeId,
      type: 'loan_emi',
      componentCode: 'LOAN_EMI',
      amount: inst.totalAmount,
      taxable: false,
      forPeriod: period,
      sourceType: 'loan_installment',
      sourceId: inst.installmentId,
      status: 'approved',
      approvedBy: userId,
      note: `Loan EMI recovery #${inst.installmentNumber} for ${period}`,
      createdBy: userId,
      updatedBy: userId,
    }));

    // Single set-based insert; idempotent via uq_payroll_inputs_source (conflicts insert nothing
    // and are not returned, so the count reflects rows really created).
    const inserted = await db
      .insert(payrollInputs)
      .values(inputRecords)
      .onConflictDoNothing()
      .returning({ id: payrollInputs.id });

    return { inputsGenerated: inserted.length };
  }

  /**
   * Marks the period's approved loan EMI inputs as consumed by `runId` and their installments as
   * recovered. Both steps are conditional updates (`status = 'approved'` / `status = 'due'`), so
   * calling this twice or concurrently recovers each installment exactly once. Loans whose
   * installments are all recovered are completed.
   * Permission: payroll.run.lock (executed by the run locking pipeline).
   */
  async recoverInstallmentsForRun(
    ctx: RequestContext,
    db: Database,
    runId: string,
    period: string,
  ): Promise<{ installmentsRecovered: number }> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_RUN_LOCK)) {
      throw new ForbiddenError('Permission denied: payroll.run.lock required');
    }

    const consumed = await db
      .update(payrollInputs)
      .set({ status: 'consumed', consumedRunId: runId, updatedAt: new Date(), updatedBy: ctx.userId ?? null })
      .where(
        and(
          eq(payrollInputs.companyId, ctx.companyId),
          eq(payrollInputs.forPeriod, period),
          eq(payrollInputs.type, 'loan_emi'),
          eq(payrollInputs.status, 'approved'),
          eq(payrollInputs.sourceType, 'loan_installment'),
          isNull(payrollInputs.deletedAt),
        ),
      )
      .returning({ sourceId: payrollInputs.sourceId });

    const installmentIds = consumed.map(c => c.sourceId).filter((id): id is string => Boolean(id));
    if (installmentIds.length === 0) {
      return { installmentsRecovered: 0 };
    }

    const recovered = await db
      .update(loanInstallments)
      .set({
        status: 'recovered',
        recoveredRunId: runId,
        recoveredAt: new Date(),
        updatedAt: new Date(),
        updatedBy: ctx.userId ?? null,
      })
      .where(
        and(
          eq(loanInstallments.companyId, ctx.companyId),
          inArray(loanInstallments.id, installmentIds),
          eq(loanInstallments.status, 'due'),
        ),
      )
      .returning({ loanId: loanInstallments.loanId });

    const loanIds = [...new Set(recovered.map(r => r.loanId))];
    for (const loanId of loanIds) {
      const [remaining] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(loanInstallments)
        .where(
          and(
            eq(loanInstallments.companyId, ctx.companyId),
            eq(loanInstallments.loanId, loanId),
            eq(loanInstallments.status, 'due'),
          ),
        );
      if ((remaining?.count ?? 0) === 0) {
        await db
          .update(employeeLoans)
          .set({ status: 'completed', updatedAt: new Date(), updatedBy: ctx.userId ?? null })
          .where(and(eq(employeeLoans.companyId, ctx.companyId), eq(employeeLoans.id, loanId)));
      }
    }

    return { installmentsRecovered: recovered.length };
  }
}
