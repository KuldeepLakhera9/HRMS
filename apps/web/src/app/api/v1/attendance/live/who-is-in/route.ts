import { z } from 'zod';
import {
  createNextRoute,
  AttendancePunchService,
} from '@hrms/core';

const punchService = new AttendancePunchService();

export const GET = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: z.object({
    departmentId: z.string().uuid().optional(),
    locationId: z.string().uuid().optional(),
    status: z.enum(['in', 'out']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  handler: async (input, ctx) => {
    const whoIsIn = await punchService.getWhoIsIn(ctx, {
      departmentId: input.departmentId,
      locationId: input.locationId,
      status: input.status,
      limit: input.limit,
    });
    return { data: whoIsIn, statusCode: 200 };
  },
});
