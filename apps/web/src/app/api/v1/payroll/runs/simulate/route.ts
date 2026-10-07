import { z } from 'zod';
import { createNextRoute, PayrollReviewService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const reviewService = new PayrollReviewService();

const simulateSchema = z.object({
  runId: z.string().uuid(),
  employeeId: z.string().uuid(),
  paidDays: z.number().min(0).max(31).optional(),
  lopDays: z.number().min(0).max(31).optional(),
  additionalInputs: z
    .array(
      z.object({
        type: z.string(),
        componentCode: z.string().optional(),
        amount: z.number(),
      }),
    )
    .optional(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RUN_CALCULATE,
  schema: simulateSchema,
  handler: async (body, ctx, tx) => {
    const result = await reviewService.simulatePayslip(ctx, tx!, body.runId, body.employeeId, {
      paidDays: body.paidDays,
      lopDays: body.lopDays,
      additionalInputs: body.additionalInputs,
    });
    return { data: result };
  },
});
