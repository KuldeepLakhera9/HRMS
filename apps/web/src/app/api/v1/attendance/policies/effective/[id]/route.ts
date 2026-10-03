import { z } from 'zod';
import { createNextRoute, AttendancePolicyService } from '@hrms/core';

const attendancePolicyService = new AttendancePolicyService();

export const GET = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: z.object({
    id: z.string().uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),
  handler: async (input, ctx) => {
    const effective = await attendancePolicyService.resolveEffectivePolicy(
      ctx,
      input.id,
      input.date,
    );
    return { data: effective, statusCode: 200 };
  },
});
