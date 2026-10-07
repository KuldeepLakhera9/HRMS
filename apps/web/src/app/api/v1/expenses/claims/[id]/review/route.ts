import { z } from 'zod';
import { createNextRoute, ExpenseService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const expenseService = new ExpenseService();

const reviewClaimSchema = z.object({
  id: z.string().uuid(),
  decisions: z.array(
    z.object({
      itemId: z.string().uuid(),
      status: z.enum(['approved', 'rejected']),
      approvedAmount: z.number().min(0).optional(),
      rejectionReason: z.string().optional(),
    }),
  ).min(1),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.EXPENSE_CLAIM_APPROVE,
  schema: reviewClaimSchema,
  handler: async (body, ctx, tx) => {
    const updated = await expenseService.reviewClaim(ctx, tx!, body.id, body.decisions);
    return { data: updated };
  },
});
