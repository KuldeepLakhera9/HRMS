import { and, eq, desc, inArray, sql } from 'drizzle-orm';
import {
  Database,
  expenseCategories,
  expensePolicies,
  expenseClaims,
  expenseItems,
  payrollInputs,
  employees,
  ExpenseClaim,
  ExpenseItem,
} from '@hrms/db';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  PERMISSIONS,
} from '@hrms/shared';
import type { RequestContext } from '../../routing/context.js';

export interface CreateExpenseItemInput {
  expenseDate: string;
  categoryId: string;
  amount: number;
  merchant?: string;
  description?: string;
  billFileId?: string;
  billHash?: string;
}

export interface ReviewItemDecision {
  itemId: string;
  status: 'approved' | 'rejected';
  approvedAmount?: number;
  rejectionReason?: string;
}

export class ExpenseService {
  /**
   * List all active expense categories
   */
  async listCategories(ctx: RequestContext, db: Database) {
    return await db
      .select()
      .from(expenseCategories)
      .where(and(eq(expenseCategories.companyId, ctx.companyId), eq(expenseCategories.isActive, true)));
  }

  /**
   * Create an expense category
   */
  async createCategory(
    ctx: RequestContext,
    db: Database,
    data: {
      code: string;
      name: string;
      perClaimLimit?: number;
      perMonthLimit?: number;
      billRequiredAbove?: number;
      taxable?: boolean;
      glCode?: string;
      allowedGrades?: string[];
    },
  ) {
    if (!ctx.permissions?.includes(PERMISSIONS.EXPENSE_CATEGORY_MANAGE)) {
      throw new ForbiddenError('Permission denied: expense.category.manage required');
    }

    const [created] = await db
      .insert(expenseCategories)
      .values({
        companyId: ctx.companyId,
        code: data.code.toUpperCase().trim(),
        name: data.name.trim(),
        perClaimLimit: data.perClaimLimit !== undefined ? data.perClaimLimit.toFixed(2) : null,
        perMonthLimit: data.perMonthLimit !== undefined ? data.perMonthLimit.toFixed(2) : null,
        billRequiredAbove: (data.billRequiredAbove ?? 0).toFixed(2),
        taxable: data.taxable ?? false,
        glCode: data.glCode ?? null,
        allowedGrades: data.allowedGrades ?? [],
        isActive: true,
        createdBy: ctx.userId ?? 'system',
        updatedBy: ctx.userId ?? 'system',
      })
      .returning();

    if (!created) throw new Error('Failed to create expense category');
    return created;
  }

  /**
   * Create an expense policy
   */
  async createPolicy(
    ctx: RequestContext,
    db: Database,
    data: {
      categoryId: string;
      gradeId?: string;
      limits?: Record<string, unknown>;
      rules?: Record<string, unknown>;
    },
  ) {
    if (!ctx.permissions?.includes(PERMISSIONS.EXPENSE_POLICY_MANAGE)) {
      throw new ForbiddenError('Permission denied: expense.policy.manage required');
    }

    const [created] = await db
      .insert(expensePolicies)
      .values({
        companyId: ctx.companyId,
        categoryId: data.categoryId,
        gradeId: data.gradeId ?? null,
        limits: data.limits ?? {},
        rules: data.rules ?? {},
        createdBy: ctx.userId ?? 'system',
        updatedBy: ctx.userId ?? 'system',
      })
      .returning();

    if (!created) throw new Error('Failed to create expense policy');
    return created;
  }

  /**
   * Create an expense claim with item line-items and duplicate bill check.
   */
  async createClaim(
    ctx: RequestContext,
    db: Database,
    data: {
      title: string;
      payoutMode?: 'payroll' | 'bank';
      items: CreateExpenseItemInput[];
    },
  ) {
    if (!ctx.permissions?.includes(PERMISSIONS.EXPENSE_CLAIM_CREATE)) {
      throw new ForbiddenError('Permission denied: expense.claim.create required');
    }

    const employeeId = ctx.employeeId;
    if (!employeeId) {
      throw new ValidationError('User must be linked to an employee record to submit expense claims');
    }

    if (!data.items || data.items.length === 0) {
      throw new ValidationError('Expense claim must contain at least one item');
    }

    const totalClaimed = data.items.reduce((sum, item) => sum + Number(item.amount), 0);
    const claimNo = `EXP-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    return await db.transaction(async tx => {
      // 1. Create claim header
      const [claim] = await tx
        .insert(expenseClaims)
        .values({
          companyId: ctx.companyId,
          employeeId,
          claimNo,
          title: data.title.trim(),
          status: 'draft',
          totalClaimed: totalClaimed.toFixed(2),
          totalApproved: '0.00',
          payoutMode: data.payoutMode ?? 'payroll',
          createdBy: ctx.userId ?? 'system',
          updatedBy: ctx.userId ?? 'system',
        })
        .returning();

      if (!claim) throw new Error('Failed to create expense claim');

      // 2. Validate and insert items
      const createdItems: ExpenseItem[] = [];

      for (const item of data.items) {
        const policyFlags: string[] = [];

        // Check for duplicate bill hash across existing company items
        if (item.billHash) {
          const [existingDuplicate] = await tx
            .select({ id: expenseItems.id, claimId: expenseItems.claimId })
            .from(expenseItems)
            .where(
              and(
                eq(expenseItems.companyId, ctx.companyId),
                eq(expenseItems.billHash, item.billHash),
                inArray(expenseItems.status, ['pending', 'approved']),
              ),
            );

          if (existingDuplicate) {
            policyFlags.push('DUPLICATE_RECEIPT');
          }
        }

        const [createdItem] = await tx
          .insert(expenseItems)
          .values({
            companyId: ctx.companyId,
            claimId: claim.id,
            expenseDate: item.expenseDate,
            categoryId: item.categoryId,
            amount: Number(item.amount).toFixed(2),
            merchant: item.merchant ?? null,
            description: item.description ?? null,
            billFileId: item.billFileId ?? null,
            billHash: item.billHash ?? null,
            policyFlags,
            approvedAmount: '0.00',
            status: 'pending',
            createdBy: ctx.userId ?? 'system',
            updatedBy: ctx.userId ?? 'system',
          })
          .returning();

        if (createdItem) {
          createdItems.push(createdItem);
        }
      }

      return {
        claim,
        items: createdItems,
      };
    });
  }

  /**
   * Submit an expense claim for approval
   */
  async submitClaim(ctx: RequestContext, db: Database, claimId: string) {
    const [claim] = await db
      .select()
      .from(expenseClaims)
      .where(and(eq(expenseClaims.companyId, ctx.companyId), eq(expenseClaims.id, claimId)));

    if (!claim) throw new NotFoundError('Expense claim not found');

    // IDOR check: Regular employee can only submit their own claim
    const hasAdmin = ctx.permissions?.includes(PERMISSIONS.EXPENSE_CLAIM_APPROVE);
    if (!hasAdmin && claim.employeeId !== ctx.employeeId) {
      throw new ForbiddenError('Cannot submit another employee’s claim');
    }

    if (claim.status !== 'draft') {
      throw new ValidationError(`Cannot submit claim in status '${claim.status}'`);
    }

    const [updated] = await db
      .update(expenseClaims)
      .set({
        status: 'submitted',
        submittedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: ctx.userId ?? 'system',
      })
      .where(and(eq(expenseClaims.companyId, ctx.companyId), eq(expenseClaims.id, claimId)))
      .returning();

    return updated;
  }

  /**
   * Multi-item review: Approver reviews claim line items individually.
   * Calculates total approved amount and updates claim status.
   */
  async reviewClaim(
    ctx: RequestContext,
    db: Database,
    claimId: string,
    decisions: ReviewItemDecision[],
  ) {
    if (!ctx.permissions?.includes(PERMISSIONS.EXPENSE_CLAIM_APPROVE)) {
      throw new ForbiddenError('Permission denied: expense.claim.approve required');
    }

    const [claim] = await db
      .select()
      .from(expenseClaims)
      .where(and(eq(expenseClaims.companyId, ctx.companyId), eq(expenseClaims.id, claimId)));

    if (!claim) throw new NotFoundError('Expense claim not found');

    if (!['submitted', 'draft'].includes(claim.status)) {
      throw new ValidationError(`Cannot review claim with current status '${claim.status}'`);
    }

    return await db.transaction(async tx => {
      let approvedCount = 0;
      let rejectedCount = 0;
      let totalApproved = 0;

      for (const d of decisions) {
        const [item] = await tx
          .select()
          .from(expenseItems)
          .where(
            and(
              eq(expenseItems.companyId, ctx.companyId),
              eq(expenseItems.claimId, claimId),
              eq(expenseItems.id, d.itemId),
            ),
          );

        if (!item) continue;

        let itemApprovedAmount = '0.00';
        if (d.status === 'approved') {
          const amt = d.approvedAmount !== undefined ? d.approvedAmount : Number(item.amount);
          itemApprovedAmount = Math.max(0, amt).toFixed(2);
          totalApproved += Number(itemApprovedAmount);
          approvedCount++;
        } else {
          rejectedCount++;
        }

        await tx
          .update(expenseItems)
          .set({
            status: d.status,
            approvedAmount: itemApprovedAmount,
            rejectionReason: d.rejectionReason ?? null,
            updatedAt: new Date(),
            updatedBy: ctx.userId ?? 'system',
          })
          .where(and(eq(expenseItems.companyId, ctx.companyId), eq(expenseItems.id, d.itemId)));
      }

      // Determine final claim status
      let finalStatus: ExpenseClaim['status'] = 'rejected';
      if (approvedCount > 0 && rejectedCount === 0) {
        finalStatus = 'approved';
      } else if (approvedCount > 0 && rejectedCount > 0) {
        finalStatus = 'partially_approved';
      }

      const [updatedClaim] = await tx
        .update(expenseClaims)
        .set({
          status: finalStatus,
          totalApproved: totalApproved.toFixed(2),
          approvedAt: new Date(),
          updatedAt: new Date(),
          updatedBy: ctx.userId ?? 'system',
        })
        .where(and(eq(expenseClaims.companyId, ctx.companyId), eq(expenseClaims.id, claimId)))
        .returning();

      return updatedClaim;
    });
  }

  /**
   * Payout approved expense claim via Payroll input.
   * Ensures exactly-once payout: idempotent input generation and status transition.
   */
  async payoutClaimViaPayroll(
    ctx: RequestContext,
    db: Database,
    claimId: string,
    period: string,
  ) {
    if (!ctx.permissions?.includes(PERMISSIONS.EXPENSE_CLAIM_PAY)) {
      throw new ForbiddenError('Permission denied: expense.claim.pay required');
    }

    const [claim] = await db
      .select()
      .from(expenseClaims)
      .where(and(eq(expenseClaims.companyId, ctx.companyId), eq(expenseClaims.id, claimId)));

    if (!claim) throw new NotFoundError('Expense claim not found');

    if (!['approved', 'partially_approved'].includes(claim.status)) {
      throw new ValidationError(`Claim must be approved or partially approved for payout (current: ${claim.status})`);
    }

    if (claim.paidAt || claim.status === 'paid') {
      throw new ValidationError('Expense claim has already been paid');
    }

    const approvedAmount = Number(claim.totalApproved);
    if (approvedAmount <= 0) {
      throw new ValidationError('Cannot payout an expense claim with ₹0.00 approved amount');
    }

    return await db.transaction(async tx => {
      // 1. Check if payroll input already exists (idempotency)
      const [existingInput] = await tx
        .select()
        .from(payrollInputs)
        .where(
          and(
            eq(payrollInputs.companyId, ctx.companyId),
            eq(payrollInputs.sourceType, 'expense'),
            eq(payrollInputs.sourceId, claim.id),
          ),
        );

      let inputId = existingInput?.id;

      if (!existingInput) {
        const [createdInput] = await tx
          .insert(payrollInputs)
          .values({
            companyId: ctx.companyId,
            employeeId: claim.employeeId,
            type: 'reimbursement',
            componentCode: 'EXPENSE_REIMB',
            amount: approvedAmount.toFixed(2),
            taxable: false,
            forPeriod: period,
            sourceType: 'expense',
            sourceId: claim.id,
            status: 'approved',
            note: `Expense claim reimbursement #${claim.claimNo}`,
            createdBy: ctx.userId ?? 'system',
            updatedBy: ctx.userId ?? 'system',
          })
          .returning();

        inputId = createdInput!.id;
      }

      // 2. Update claim payout ref
      const [updated] = await tx
        .update(expenseClaims)
        .set({
          payoutMode: 'payroll',
          payoutRef: inputId,
          updatedAt: new Date(),
          updatedBy: ctx.userId ?? 'system',
        })
        .where(and(eq(expenseClaims.companyId, ctx.companyId), eq(expenseClaims.id, claimId)))
        .returning();

      return {
        claim: updated,
        inputId,
        approvedAmount,
      };
    });
  }

  /**
   * List claims with IDOR protection
   */
  async listClaims(
    ctx: RequestContext,
    db: Database,
    filters: {
      employeeId?: string;
      status?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const hasApprover = ctx.permissions?.includes(PERMISSIONS.EXPENSE_CLAIM_APPROVE);
    const targetEmployeeId = hasApprover ? filters.employeeId : ctx.employeeId;

    const conditions = [eq(expenseClaims.companyId, ctx.companyId)];
    if (targetEmployeeId) {
      conditions.push(eq(expenseClaims.employeeId, targetEmployeeId));
    }
    if (filters.status) {
      conditions.push(eq(expenseClaims.status, filters.status as unknown as ExpenseClaim['status']));
    }

    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
    const offset = Math.max(0, filters.offset ?? 0);

    const rows = await db
      .select({
        claim: expenseClaims,
        employeeName: sql<string>`concat(${employees.firstName}, ' ', ${employees.lastName})`,
        empCode: employees.empCode,
      })
      .from(expenseClaims)
      .innerJoin(
        employees,
        and(eq(employees.companyId, expenseClaims.companyId), eq(employees.id, expenseClaims.employeeId)),
      )
      .where(and(...conditions))
      .orderBy(desc(expenseClaims.createdAt))
      .limit(limit)
      .offset(offset);

    return rows.map(r => ({
      ...r.claim,
      employeeName: r.employeeName,
      empCode: r.empCode,
    }));
  }

  /**
   * Get single claim with all its item line-items (with IDOR check)
   */
  async getClaimDetails(ctx: RequestContext, db: Database, claimId: string) {
    const [claim] = await db
      .select({
        claim: expenseClaims,
        employeeName: sql<string>`concat(${employees.firstName}, ' ', ${employees.lastName})`,
        empCode: employees.empCode,
      })
      .from(expenseClaims)
      .innerJoin(
        employees,
        and(eq(employees.companyId, expenseClaims.companyId), eq(employees.id, expenseClaims.employeeId)),
      )
      .where(and(eq(expenseClaims.companyId, ctx.companyId), eq(expenseClaims.id, claimId)));

    if (!claim) throw new NotFoundError('Expense claim not found');

    const hasApprover = ctx.permissions?.includes(PERMISSIONS.EXPENSE_CLAIM_APPROVE);
    if (!hasApprover && claim.claim.employeeId !== ctx.employeeId) {
      throw new ForbiddenError('Cannot view another employee’s claim');
    }

    const items = await db
      .select()
      .from(expenseItems)
      .where(and(eq(expenseItems.companyId, ctx.companyId), eq(expenseItems.claimId, claimId)));

    return {
      ...claim.claim,
      employeeName: claim.employeeName,
      empCode: claim.empCode,
      items,
    };
  }
}
