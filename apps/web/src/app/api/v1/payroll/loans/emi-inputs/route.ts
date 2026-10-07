import { z } from 'zod';
import { createNextRoute, LoanService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const loanService = new LoanService();

const generateEmiSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_LOAN_MANAGE,
  schema: generateEmiSchema,
  handler: async (body, ctx, tx) => {
    const result = await loanService.generateEmiInputsForPeriod(ctx, tx!, body.period);
    return { data: result };
  },
});
