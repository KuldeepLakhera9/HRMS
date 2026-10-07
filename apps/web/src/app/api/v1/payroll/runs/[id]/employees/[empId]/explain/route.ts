import { z } from 'zod';
import { createNextRoute, PayrollReviewService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const reviewService = new PayrollReviewService();

const explainEmployeeSchema = z.object({
  id: z.string().uuid(),
  empId: z.string().uuid(),
});

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RUN_READ,
  schema: explainEmployeeSchema,
  handler: async (query, ctx, tx) => {
    const result = await reviewService.explainPayslip(ctx, tx!, query.id, query.empId);
    return { data: result };
  },
});
