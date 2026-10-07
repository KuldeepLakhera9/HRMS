import { z } from 'zod';
import { createNextRoute, PayrollReviewService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const reviewService = new PayrollReviewService();

const releaseEmployeeSchema = z.object({
  id: z.string().uuid(),
  empId: z.string().uuid(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RUN_HOLD_EMPLOYEE,
  schema: releaseEmployeeSchema,
  handler: async (body, ctx, tx) => {
    await reviewService.releaseEmployee(ctx, tx!, body.id, body.empId);
    return { data: { success: true, employeeId: body.empId, status: 'included' } };
  },
});
