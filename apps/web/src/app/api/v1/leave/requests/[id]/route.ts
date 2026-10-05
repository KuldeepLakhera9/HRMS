import { z } from 'zod';
import { createNextRoute, LeaveService } from '@hrms/core';

const leaveService = new LeaveService();

const getLeaveRequestSchema = z.object({
  id: z.string().uuid(),
});

export const GET = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: getLeaveRequestSchema,
  handler: async (input, ctx) => {
    const result = await leaveService.getRequestById(ctx, input.id);
    return { data: result };
  },
});
