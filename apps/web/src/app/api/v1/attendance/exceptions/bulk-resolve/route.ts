import {
  createNextRoute,
  AttendanceExceptionsService,
  bulkResolveExceptionsSchema,
} from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const exceptionsService = new AttendanceExceptionsService();

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.ATTENDANCE_EXCEPTION_MANAGE,
  skipTenantTransaction: true,
  schema: bulkResolveExceptionsSchema,
  handler: async (input, ctx) => {
    const result = await exceptionsService.bulkResolveExceptions(ctx, {
      dayIds: input.dayIds,
      action: input.action,
      comments: input.comments,
    });

    return {
      data: result,
      statusCode: 200,
    };
  },
});
