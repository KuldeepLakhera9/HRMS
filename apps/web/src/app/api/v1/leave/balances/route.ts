import {
  createNextRoute,
  LeaveService,
  ListBalancesQuerySchema,
} from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const leaveService = new LeaveService();

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.LEAVE_BALANCE_READ,
  skipTenantTransaction: true,
  schema: ListBalancesQuerySchema,
  handler: async (query, ctx) => {
    const balances = await leaveService.getBalances(
      ctx,
      query.employeeId,
      query.year ? String(query.year) : undefined,
    );
    return { data: balances };
  },
});
