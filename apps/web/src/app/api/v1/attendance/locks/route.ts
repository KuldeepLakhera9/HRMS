import {
  createNextRoute,
  AttendanceLockService,
  lockPeriodSchema,
} from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const lockService = new AttendanceLockService();

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.ATTENDANCE_LOCK_MANAGE,
  skipTenantTransaction: true,
  handler: async (_input, ctx) => {
    const locks = await lockService.listLocks(ctx.companyId);
    return {
      data: locks,
    };
  },
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.ATTENDANCE_LOCK_MANAGE,
  skipTenantTransaction: true,
  schema: lockPeriodSchema,
  handler: async (input, ctx) => {
    const lock = await lockService.lockPeriod(ctx, input);
    return {
      data: lock,
      statusCode: 201,
    };
  },
});
