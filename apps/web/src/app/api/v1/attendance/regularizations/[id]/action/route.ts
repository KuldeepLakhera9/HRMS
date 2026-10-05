import { z } from 'zod';
import { createNextRoute, RegularizationService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const regularizationService = new RegularizationService();

const actionSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(['approve', 'reject']),
  comments: z.string().max(500).optional(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.ATTENDANCE_REGULARIZATION_APPROVE,
  skipTenantTransaction: true,
  schema: actionSchema,
  handler: async (input, ctx) => {
    const updated = await regularizationService.decideRequest(ctx, input.id, {
      action: input.action,
      comments: input.comments,
    });
    return { data: updated };
  },
});
