import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
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
import { withDbErrorTranslation } from '../db-errors.js';

export const MAX_INPUT_PAGE_SIZE = 100;

export interface ListInputsQuery {
  period?: string;
  status?: 'pending' | 'approved' | 'consumed' | 'cancelled';
  employeeId?: string;
  cursor?: { createdAt: string; id: string };
  limit?: number;
}

export interface ListInputsResult {
  items: PayrollInput[];
  nextCursor: { createdAt: string; id: string } | null;
}

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

    const [created] = await withDbErrorTranslation(() =>
      db.insert(payrollInputs).values(inputRecord).returning(),
    );
    if (!created) throw new Error('Failed to create payroll input');
    return created;
  }

  /**
   * Loads an input under a row lock so concurrent approve/reject calls serialise.
   */
  private async lockInput(
    ctx: RequestContext,
    db: Database,
    inputId: string,
  ): Promise<PayrollInput> {
    const [input] = await db
      .select()
      .from(payrollInputs)
      .where(
        and(
          eq(payrollInputs.companyId, ctx.companyId),
          eq(payrollInputs.id, inputId),
          isNull(payrollInputs.deletedAt),
        ),
      )
      .for('update');
    if (!input) {
      throw new NotFoundError('Payroll input not found');
    }
    return input;
  }

  /**
   * Rejects (cancels) a pending payroll input. Permission: payroll.input.approve.
   * Enforces Segregation of Duties like approval.
   */
  async rejectInput(
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

    const input = await this.lockInput(ctx, db, inputId);
    assertSegregationOfDuties(input.createdBy, userId, 'payroll input');
    if (input.status !== 'pending') {
      throw new ValidationError(`Only pending inputs can be rejected (current status: ${input.status})`);
    }

    const [updated] = await db
      .update(payrollInputs)
      .set({ status: 'cancelled', updatedBy: userId, updatedAt: new Date() })
      .where(and(eq(payrollInputs.companyId, ctx.companyId), eq(payrollInputs.id, inputId)))
      .returning();
    if (!updated) throw new Error('Failed to reject payroll input');
    return updated;
  }

  /**
   * Lists inputs with keyset pagination on (created_at, id), max page size 100.
   * Permission: payroll.input.read.
   */
  async listInputs(
    ctx: RequestContext,
    db: Database,
    query: ListInputsQuery = {},
  ): Promise<ListInputsResult> {
    if (!ctx.permissions?.includes(PERMISSIONS.PAYROLL_INPUT_READ)) {
      throw new ForbiddenError('Permission denied: payroll.input.read required');
    }
    const limit = Math.min(Math.max(query.limit ?? 50, 1), MAX_INPUT_PAGE_SIZE);

    const conditions = [eq(payrollInputs.companyId, ctx.companyId), isNull(payrollInputs.deletedAt)];
    if (query.period) conditions.push(eq(payrollInputs.forPeriod, query.period));
    if (query.status) conditions.push(eq(payrollInputs.status, query.status));
    if (query.employeeId) conditions.push(eq(payrollInputs.employeeId, query.employeeId));
    if (query.cursor) {
      conditions.push(
        sql`(${payrollInputs.createdAt}, ${payrollInputs.id}) < (${query.cursor.createdAt}::timestamptz, ${query.cursor.id}::uuid)`,
      );
    }

    const rows = await db
      .select()
      .from(payrollInputs)
      .where(and(...conditions))
      .orderBy(desc(payrollInputs.createdAt), desc(payrollInputs.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: hasMore && last ? { createdAt: last.createdAt.toISOString(), id: last.id } : null,
    };
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

    const input = await this.lockInput(ctx, db, inputId);

    assertSegregationOfDuties(input.createdBy, userId, 'payroll input');

    if (input.status === 'consumed') {
      throw new ValidationError('Cannot modify an input that has already been consumed by a payroll run');
    }
    if (input.status !== 'pending') {
      throw new ValidationError(`Only pending inputs can be approved (current status: ${input.status})`);
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
