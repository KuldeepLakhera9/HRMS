import {
  createNextRoute,
  LeaveService,
  AdjustBalanceSchema,
} from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const leaveService = new LeaveService();

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.LEAVE_BALANCE_ADJUST,
  skipTenantTransaction: true,
  schema: AdjustBalanceSchema,
  handler: async (input, ctx) => {
    const updated = await leaveService.adjustBalance(ctx, input);
    return { data: updated };
  },
});
