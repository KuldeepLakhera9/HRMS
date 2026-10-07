import { z } from 'zod';
import { createNextRoute, PayrollReviewService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const reviewService = new PayrollReviewService();

const runSummarySchema = z.object({
  id: z.string().uuid(),
});

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RUN_READ,
  schema: runSummarySchema,
  handler: async (input, ctx, tx) => {
    const summary = await reviewService.getSummary(ctx, tx!, input.id);
    return { data: summary };
  },
});
