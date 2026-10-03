import { z } from 'zod';
import {
  createNextRoute,
  AttendancePolicyService,
} from '@hrms/core';

const attendancePolicyService = new AttendancePolicyService();

export const GET = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: z.object({
    id: z.string().uuid(),
  }),
  handler: async (input, ctx) => {
    const policy = await attendancePolicyService.getPolicy(ctx, input.id);
    return { data: policy, statusCode: 200 };
  },
});

const patchPolicySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  geofenceMode: z.enum(['strict', 'soft', 'off']).optional(),
  allowSelfie: z.boolean().optional(),
  requireSelfie: z.boolean().optional(),
  maxGpsAccuracyMeters: z.number().int().min(1).max(1000).optional(),
  allowedSources: z.array(z.string()).optional(),
  graceMinutes: z.number().int().min(0).max(180).optional(),
  halfDayMinutes: z.number().int().min(0).max(720).optional(),
  fullDayMinutes: z.number().int().min(0).max(1440).optional(),
  autoPunchOutHours: z.string().regex(/^\d+(\.\d)?$/).optional(),
});

export const PATCH = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: patchPolicySchema,
  handler: async (input, ctx) => {
    const { id, ...data } = input;
    const updated = await attendancePolicyService.updatePolicy(ctx, id, data);
    return { data: updated, statusCode: 200 };
  },
});

