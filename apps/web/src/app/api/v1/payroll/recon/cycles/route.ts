import { z } from 'zod';
import { createNextRoute, ReconciliationService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const reconService = new ReconciliationService();

const createCycleSchema = z.object({
  period: z.string(),
  runId: z.string().uuid(),
  tolerance: z.union([z.number(), z.string()]).default(1.0),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RECON_MANAGE,
  schema: createCycleSchema,
  handler: async (input, ctx, tx) => {
    const cycle = await reconService.createCycle(ctx, tx!, input);
    return { success: true, cycle };
  },
});
