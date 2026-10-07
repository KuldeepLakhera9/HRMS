import { z } from 'zod';
import { createNextRoute, ExpenseService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const expenseService = new ExpenseService();

const submitClaimSchema = z.object({
  id: z.string().uuid(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.EXPENSE_CLAIM_CREATE,
  schema: submitClaimSchema,
  handler: async (body, ctx, tx) => {
    const updated = await expenseService.submitClaim(ctx, tx!, body.id);
    return { data: updated };
  },
});
