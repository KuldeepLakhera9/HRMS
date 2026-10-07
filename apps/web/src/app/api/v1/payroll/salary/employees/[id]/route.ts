import { z } from 'zod';
import { createNextRoute, SalaryService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const salaryService = new SalaryService();

const getSalarySchema = z.object({
  id: z.string().uuid(),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  unmask: z
    .union([z.boolean(), z.string().transform(v => v === 'true')])
    .optional(),
});

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_SALARY_VIEW,
  schema: getSalarySchema,
  handler: async (input, ctx, tx) => {
    const asOfDate = input.asOfDate ?? new Date().toISOString().slice(0, 10);
    const salary = await salaryService.getEmployeeSalary(ctx, tx!, input.id, asOfDate, {
      unmask: Boolean(input.unmask),
    });
    return { data: salary };
  },
});
