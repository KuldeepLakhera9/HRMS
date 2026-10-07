import { z } from 'zod';
import { createNextRoute, ExpenseService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const expenseService = new ExpenseService();

const payoutClaimSchema = z.object({
  id: z.string().uuid(),
  period: z.string().regex(/^\d{4}-\d{2}$/, 'Period must be in YYYY-MM format'),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.EXPENSE_CLAIM_PAY,
  schema: payoutClaimSchema,
  handler: async (body, ctx, tx) => {
    const result = await expenseService.payoutClaimViaPayroll(ctx, tx!, body.id, body.period);
    return { data: result };
  },
});
