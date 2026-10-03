import { z } from 'zod';
import {
  createNextRoute,
  AttendancePolicyService,
  createAttendancePolicySchema,
} from '@hrms/core';

const attendancePolicyService = new AttendancePolicyService();

export const GET = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: z.object({}),
  handler: async (_input, ctx) => {
    const policies = await attendancePolicyService.listPolicies(ctx);
    return { data: policies, statusCode: 200 };
  },
});

export const POST = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: createAttendancePolicySchema,
  handler: async (input, ctx) => {
    const parsed = createAttendancePolicySchema.parse(input);
    const policy = await attendancePolicyService.createPolicy(ctx, parsed);
    return { data: policy, statusCode: 201 };
  },
});
