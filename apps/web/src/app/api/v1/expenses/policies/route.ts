import { z } from 'zod';
import { createNextRoute, ExpenseService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const expenseService = new ExpenseService();

const createPolicySchema = z.object({
  categoryId: z.string().uuid(),
  gradeId: z.string().uuid().optional(),
  limits: z.record(z.unknown()).optional(),
  rules: z.record(z.unknown()).optional(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.EXPENSE_POLICY_MANAGE,
  schema: createPolicySchema,
  handler: async (body, ctx, tx) => {
    const policy = await expenseService.createPolicy(ctx, tx!, body);
    return { data: policy };
  },
});
