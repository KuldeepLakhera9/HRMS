import { z } from 'zod';
import { createNextRoute, LoanService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const loanService = new LoanService();

const listLoansSchema = z.object({
  employeeId: z.string().uuid().optional(),
  status: z.enum(['active', 'cancelled', 'completed', 'paused']).optional(),
});

const createLoanSchema = z.object({
  employeeId: z.string().uuid(),
  type: z.enum(['loan', 'advance']).default('loan'),
  principal: z.coerce.string().min(1),
  interestRate: z.coerce.string().optional(),
  installmentsCount: z.number().int().positive(),
  startPeriod: z.string().regex(/^\d{4}-\d{2}$/),
  interestType: z.enum(['none', 'flat']).default('none'),
});

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_LOAN_READ,
  schema: listLoansSchema,
  handler: async (query, ctx, tx) => {
    const loans = await loanService.listLoans(ctx, tx!, query);
    return { data: loans };
  },
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_LOAN_MANAGE,
  schema: createLoanSchema,
  handler: async (body, ctx, tx) => {
    const result = await loanService.createLoan(ctx, tx!, body);
    return { data: result };
  },
});
