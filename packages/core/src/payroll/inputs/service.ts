import { and, eq, inArray } from 'drizzle-orm';
import {
  Database,
  payrollInputs,
  PayrollInput,
  NewPayrollInput,
} from '@hrms/db';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../../routing/context.js';
import { assertSegregationOfDuties } from '../maker-checker.js';

export interface CreatePayrollInputDto {
  employeeId: string;
  type:
    | 'bonus'
    | 'incentive'
    | 'arrear'
    | 'deduction'
    | 'loan_emi'
    | 'reimbursement'
    | 'adjustment'
    | 'lop_override'
    | 'leave_encashment'
    | 'other';
  componentCode?: string;
  amount: string | number;
  taxable?: boolean;
  forPeriod: string; // 'YYYY-MM'
  sourceType?: string;
  sourceId?: string;
  note?: string;
}

export class PayrollInputService {
  /**
   * Creates a new payroll input item (pending approval by default for manual inputs).
   */
  async createInput(
    ctx: RequestContext,
    db: Database,
    dto: CreatePayrollInputDto,
  ): Promise<PayrollInput> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_INPUT_CREATE)) {
      throw new ForbiddenError('Permission denied: payroll.input.create required');
    }
    const userId = ctx.userId;
    if (!userId) {
      throw new UnauthorizedError('User authentication required');
    }

    const inputRecord: NewPayrollInput = {
      companyId: ctx.companyId,
      employeeId: dto.employeeId,
      type: dto.type,
      componentCode: dto.componentCode || null,
      amount: String(dto.amount),
      taxable: dto.taxable ?? true,
      forPeriod: dto.forPeriod,
      sourceType: dto.sourceType || 'manual',
      sourceId: dto.sourceId || null,
      status: 'pending',
      note: dto.note || null,
      createdBy: userId,
      updatedBy: userId,
    };

    const [created] = await db.insert(payrollInputs).values(inputRecord).returning();
    if (!created) throw new Error('Failed to create payroll input');
    return created;
  }

  /**
   * Approves a pending payroll input.
   * Enforces Segregation of Duties: a user cannot approve inputs they created.
   */
  async approveInput(
    ctx: RequestContext,
    db: Database,
    inputId: string,
  ): Promise<PayrollInput> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_INPUT_APPROVE)) {
      throw new ForbiddenError('Permission denied: payroll.input.approve required');
    }
    const userId = ctx.userId;
    if (!userId) {
      throw new UnauthorizedError('User authentication required');
    }

    const [input] = await db
      .select()
      .from(payrollInputs)
      .where(and(eq(payrollInputs.companyId, ctx.companyId), eq(payrollInputs.id, inputId)));

    if (!input) {
      throw new NotFoundError('Payroll input not found');
    }

    assertSegregationOfDuties(input.createdBy, userId, 'payroll input');

    if (input.status === 'consumed') {
      throw new ValidationError('Cannot modify an input that has already been consumed by a payroll run');
    }

    const [updated] = await db
      .update(payrollInputs)
      .set({
        status: 'approved',
        approvedBy: userId,
        updatedBy: userId,
        updatedAt: new Date(),
      })
      .where(and(eq(payrollInputs.companyId, ctx.companyId), eq(payrollInputs.id, inputId)))
      .returning();

    if (!updated) throw new Error('Failed to approve payroll input');
    return updated;
  }

  /**
   * Retrieves all approved inputs for a given period, optionally filtered by employee IDs.
   */
  async listApprovedInputsForPeriod(
    ctx: RequestContext,
    db: Database,
    period: string,
    employeeIds?: string[],
  ): Promise<PayrollInput[]> {
    const conditions = [
      eq(payrollInputs.companyId, ctx.companyId),
      eq(payrollInputs.forPeriod, period),
      eq(payrollInputs.status, 'approved'),
    ];

    if (employeeIds && employeeIds.length > 0) {
      conditions.push(inArray(payrollInputs.employeeId, employeeIds));
    }

    return db
      .select()
      .from(payrollInputs)
      .where(and(...conditions));
  }
}
