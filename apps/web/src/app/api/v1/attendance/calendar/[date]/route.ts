import { z } from 'zod';
import {
  createNextRoute,
  AttendanceExceptionsService,
} from '@hrms/core';

const exceptionsService = new AttendanceExceptionsService();

export const GET = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
    employeeId: z.string().uuid().optional(),
  }),
  handler: async (input, ctx) => {
    const detail = await exceptionsService.getDayDetail(
      ctx,
      input.date,
      input.employeeId,
    );

    return {
      data: detail,
      statusCode: 200,
    };
  },
});
