import { z } from 'zod';
import { createNextRoute, PayrollReviewService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const reviewService = new PayrollReviewService();

const listEmployeesSchema = z.object({
  id: z.string().uuid(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: z.enum(['included', 'held', 'excluded', 'error', 'all']).default('all'),
  hasBlockers: z
    .string()
    .optional()
    .transform(v => (v === 'true' ? true : v === 'false' ? false : undefined)),
  hasWarnings: z
    .string()
    .optional()
    .transform(v => (v === 'true' ? true : v === 'false' ? false : undefined)),
  search: z.string().optional(),
});

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RUN_READ,
  schema: listEmployeesSchema,
  handler: async (query, ctx, tx) => {
    const result = await reviewService.listEmployees(ctx, tx!, query.id, {
      cursor: query.cursor,
      limit: query.limit,
      status: query.status,
      hasBlockers: query.hasBlockers,
      hasWarnings: query.hasWarnings,
      search: query.search,
    });
    return { data: result };
  },
});
