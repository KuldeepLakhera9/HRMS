import {
  createNextRoute,
  AttendanceDayService,
  recalculateDaySchema,
} from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const dayService = new AttendanceDayService();

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.ATTENDANCE_DAY_RECALCULATE,
  skipTenantTransaction: true,
  schema: recalculateDaySchema,
  handler: async (input, ctx) => {
    const result = await dayService.recomputeDay(ctx, input.employeeId, input.workDate);
    return {
      data: result,
      statusCode: 200,
    };
  },
});
