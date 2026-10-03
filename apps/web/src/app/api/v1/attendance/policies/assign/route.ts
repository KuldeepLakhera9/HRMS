import { z } from 'zod';
import {
  createNextRoute,
  AttendancePolicyService,
  assignAttendancePolicySchema,
} from '@hrms/core';

const attendancePolicyService = new AttendancePolicyService();

export const GET = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: z.object({
    policyId: z.string().uuid().optional(),
    targetType: z.string().optional(),
    targetId: z.string().uuid().optional(),
  }),
  handler: async (input, ctx) => {
    const assignments = await attendancePolicyService.listAssignments(ctx, input);
    return { data: assignments, statusCode: 200 };
  },
});

export const POST = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: assignAttendancePolicySchema,
  handler: async (input, ctx) => {
    const assignment = await attendancePolicyService.assignPolicy(ctx, input);
    return { data: assignment, statusCode: 201 };
  },
});
