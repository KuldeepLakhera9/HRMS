import { createNextRoute, LeaveService, PreviewLeaveSchema } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const leaveService = new LeaveService();

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.LEAVE_REQUEST_CREATE,
  skipTenantTransaction: true,
  schema: PreviewLeaveSchema,
  handler: async (input, ctx) => {
    const preview = await leaveService.previewLeave(ctx, input);
    return { data: preview };
  },
});
