import { z } from 'zod';
import { createNextRoute, LeaveService, CancelLeaveRequestSchema } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const leaveService = new LeaveService();

const cancelWithIdSchema = CancelLeaveRequestSchema.extend({
  id: z.string().uuid(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.LEAVE_REQUEST_CANCEL,
  skipTenantTransaction: true,
  schema: cancelWithIdSchema,
  handler: async (input, ctx) => {
    await leaveService.cancelRequest(ctx, input.id, input.reason);
    return { data: { success: true } };
  },
});
