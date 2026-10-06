import { z } from 'zod';
import { createNextRoute, SalaryService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const salaryService = new SalaryService();

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_STRUCTURE_MANAGE,
  schema: z.object({ id: z.string().uuid() }),
  handler: async (params, ctx, tx) => {
    const approved = await salaryService.approveStructure(ctx, tx!, params.id);
    return { data: approved };
  },
});
