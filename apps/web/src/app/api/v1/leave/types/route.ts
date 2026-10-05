import { createNextRoute, LeaveService } from '@hrms/core';

const leaveService = new LeaveService();

export const GET = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  handler: async (_input, ctx) => {
    const types = await leaveService.listLeaveTypes(ctx);
    return { data: types };
  },
});
