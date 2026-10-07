import { z } from 'zod';
import { createNextRoute, PayrollReviewService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const reviewService = new PayrollReviewService();

const getVarianceSchema = z.object({
  id: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  thresholdPct: z.coerce.number().min(0).max(100).default(10),
});

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RUN_READ,
  schema: getVarianceSchema,
  handler: async (query, ctx, tx) => {
    const result = await reviewService.getVariance(ctx, tx!, query.id, {
      limit: query.limit,
      offset: query.offset,
      thresholdPct: query.thresholdPct,
    });
    return { data: result };
  },
});
