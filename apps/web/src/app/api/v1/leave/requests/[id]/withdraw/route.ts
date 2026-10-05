import { z } from 'zod';
import { createNextRoute, LeaveService } from '@hrms/core';

const leaveService = new LeaveService();

const withdrawSchema = z.object({
  id: z.string().uuid(),
});

export const POST = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: withdrawSchema,
  handler: async (input, ctx) => {
    await leaveService.withdrawRequest(ctx, input.id);
    return { data: { success: true } };
  },
});
