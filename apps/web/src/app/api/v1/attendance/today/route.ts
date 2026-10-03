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
    employeeId: z.string().uuid().optional(),
  }),
  handler: async (input, ctx) => {
    const summary = await punchService.getTodaySummary(ctx, input.employeeId);
    return { data: summary, statusCode: 200 };
  },
});
