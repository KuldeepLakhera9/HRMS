import { z } from 'zod';
import { createNextRoute, ExpenseService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const expenseService = new ExpenseService();

const listClaimsSchema = z.object({
  employeeId: z.string().uuid().optional(),
  status: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

const createClaimSchema = z.object({
  title: z.string().min(3),
  payoutMode: z.enum(['payroll', 'bank']).optional().default('payroll'),
  items: z.array(
    z.object({
      expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      categoryId: z.string().uuid(),
      amount: z.number().positive(),
      merchant: z.string().optional(),
      description: z.string().optional(),
      billFileId: z.string().uuid().optional(),
      billHash: z.string().optional(),
    }),
  ).min(1),
});

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.EXPENSE_CLAIM_READ,
  schema: listClaimsSchema,
  handler: async (query, ctx, tx) => {
    const claims = await expenseService.listClaims(ctx, tx!, {
      employeeId: query.employeeId,
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });
    return { data: claims };
  },
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.EXPENSE_CLAIM_CREATE,
  schema: createClaimSchema,
  handler: async (body, ctx, tx) => {
    const result = await expenseService.createClaim(ctx, tx!, body);
    return { data: result };
  },
});
