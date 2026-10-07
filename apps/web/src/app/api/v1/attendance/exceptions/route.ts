import {
  createNextRoute,
  AttendanceExceptionsService,
  listExceptionsSchema,
} from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const exceptionsService = new AttendanceExceptionsService();

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.ATTENDANCE_EXCEPTION_READ,
  skipTenantTransaction: true,
  schema: listExceptionsSchema,
  handler: async (input, ctx) => {
    const isRegularizedVal =
      typeof input.isRegularized === 'boolean' ? input.isRegularized : undefined;

    const [exceptionsResult, summaryResult] = await Promise.all([
      exceptionsService.listExceptions(ctx, {
        startDate: input.startDate,
        endDate: input.endDate,
        employeeId: input.employeeId,
        departmentId: input.departmentId,
        exceptionType: input.exceptionType ?? 'all',
        isRegularized: isRegularizedVal,
        cursorWorkDate: input.cursorWorkDate,
        cursorId: input.cursorId,
        limit: input.limit !== undefined ? Number(input.limit) : 50,
      }),
      exceptionsService.getExceptionSummary(ctx, input.startDate, input.endDate),
    ]);

    return {
      data: {
        items: exceptionsResult.items,
        nextCursor: exceptionsResult.nextCursor,
        summary: summaryResult,
      },
      statusCode: 200,
    };
  },
});
