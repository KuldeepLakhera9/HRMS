import { z } from 'zod';
import { createNextRoute, ExpenseService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const expenseService = new ExpenseService();

const getClaimSchema = z.object({
  id: z.string().uuid(),
});

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.EXPENSE_CLAIM_READ,
  schema: getClaimSchema,
  handler: async (params, ctx, tx) => {
    const claim = await expenseService.getClaimDetails(ctx, tx!, params.id);
    return { data: claim };
  },
});
