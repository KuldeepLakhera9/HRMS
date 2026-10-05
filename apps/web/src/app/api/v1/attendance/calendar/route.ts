import {
  createNextRoute,
  AttendanceExceptionsService,
  calendarMonthSchema,
} from '@hrms/core';

const exceptionsService = new AttendanceExceptionsService();

export const GET = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: calendarMonthSchema,
  handler: async (input, ctx) => {
    const calendar = await exceptionsService.getMonthCalendar(
      ctx,
      input.month,
      input.employeeId,
    );

    return {
      data: calendar,
      statusCode: 200,
    };
  },
});
