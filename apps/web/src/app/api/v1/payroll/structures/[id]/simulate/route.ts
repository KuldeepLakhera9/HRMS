import { z } from 'zod';
import { createNextRoute, SalaryService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const salaryService = new SalaryService();

const simulateSchema = z.object({
  id: z.string().uuid(),
  ctcAnnual: z.coerce.string().min(1),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_STRUCTURE_READ,
  schema: simulateSchema,
  handler: async (body, ctx, tx) => {
    const result = await salaryService.simulateCtcBreakup(
      ctx,
      tx!,
      body.id,
      body.ctcAnnual,
    );
    return { data: result };
  },
});
