import { z } from 'zod';
import { createNextRoute, PayrollReviewService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const reviewService = new PayrollReviewService();

const holdEmployeeSchema = z.object({
  id: z.string().uuid(),
  empId: z.string().uuid(),
  reason: z.string().min(3, 'Hold reason is required'),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RUN_HOLD_EMPLOYEE,
  schema: holdEmployeeSchema,
  handler: async (body, ctx, tx) => {
    await reviewService.holdEmployee(ctx, tx!, body.id, body.empId, body.reason);
    return { data: { success: true, employeeId: body.empId, status: 'held', reason: body.reason } };
  },
});
