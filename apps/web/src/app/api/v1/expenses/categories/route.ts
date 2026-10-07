import { z } from 'zod';
import { createNextRoute, ExpenseService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const expenseService = new ExpenseService();

const createCategorySchema = z.object({
  code: z.string().min(2).max(20),
  name: z.string().min(2),
  perClaimLimit: z.number().positive().optional(),
  perMonthLimit: z.number().positive().optional(),
  billRequiredAbove: z.number().min(0).optional(),
  taxable: z.boolean().optional(),
  glCode: z.string().optional(),
  allowedGrades: z.array(z.string()).optional(),
});

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.EXPENSE_CLAIM_READ,
  handler: async (_req, ctx, tx) => {
    const categories = await expenseService.listCategories(ctx, tx!);
    return { data: categories };
  },
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.EXPENSE_CATEGORY_MANAGE,
  schema: createCategorySchema,
  handler: async (body, ctx, tx) => {
    const category = await expenseService.createCategory(ctx, tx!, body);
    return { data: category };
  },
});
