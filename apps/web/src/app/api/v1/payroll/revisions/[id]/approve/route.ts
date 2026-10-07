import { z } from 'zod';
import { createNextRoute, SalaryRevisionService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const revisionService = new SalaryRevisionService();

const approveRevisionSchema = z.object({
  id: z.string().uuid(),
  currentPeriod: z.string().regex(/^\d{4}-\d{2}$/),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_SALARY_APPROVE,
  schema: approveRevisionSchema,
  handler: async (body, ctx, tx) => {
    const result = await revisionService.approveRevisionBatch(
      ctx,
      tx!,
      body.id,
      body.currentPeriod,
    );
    return { data: result };
  },
});
