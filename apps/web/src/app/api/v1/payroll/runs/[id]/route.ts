import { z } from 'zod';
import { createNextRoute, PayrollRunService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const runService = new PayrollRunService();

const getRunSchema = z.object({
  id: z.string().uuid(),
});

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RUN_READ,
  schema: getRunSchema,
  handler: async (input, ctx, tx) => {
    const run = await runService.getRun(ctx, tx!, input.id);
    return { data: run };
  },
});
