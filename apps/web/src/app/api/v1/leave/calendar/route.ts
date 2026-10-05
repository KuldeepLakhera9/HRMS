import {
  createNextRoute,
  LeaveService,
  LeaveCalendarQuerySchema,
} from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const leaveService = new LeaveService();

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.LEAVE_CALENDAR_READ,
  skipTenantTransaction: true,
  schema: LeaveCalendarQuerySchema,
  handler: async (query, ctx) => {
    const calendar = await leaveService.getCalendar(ctx, {
      startDate: query.startDate,
      endDate: query.endDate,
      scope: query.scope ?? 'company',
      scopeId: query.scopeId,
    });
    return { data: calendar };
  },
});
