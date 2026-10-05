import { z } from 'zod';
import { createNextRoute, LeaveService, RejectLeaveRequestSchema } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const leaveService = new LeaveService();

const rejectWithIdSchema = RejectLeaveRequestSchema.extend({
  id: z.string().uuid(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.LEAVE_REQUEST_APPROVE,
  skipTenantTransaction: true,
  schema: rejectWithIdSchema,
  handler: async (input, ctx) => {
    await leaveService.rejectRequest(ctx, input.id, input.reason);
    return { data: { success: true } };
  },
});
