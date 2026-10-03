import {
  createNextRoute,
  AttendanceLockService,
  unlockPeriodSchema,
} from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const lockService = new AttendanceLockService();

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.ATTENDANCE_LOCK_MANAGE,
  skipTenantTransaction: true,
  schema: unlockPeriodSchema,
  handler: async (input, ctx) => {
    const lock = await lockService.unlockPeriod(ctx, input);
    return {
      data: lock,
      statusCode: 200,
    };
  },
});
