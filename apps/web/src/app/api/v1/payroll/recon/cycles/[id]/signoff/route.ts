import { z } from 'zod';
import { createNextRoute, ReconciliationService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const reconService = new ReconciliationService();

const signoffSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(['ca', 'finance']),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RECON_SIGNOFF,
  schema: signoffSchema,
  handler: async (input, ctx, tx) => {
    const cycle = await reconService.signoffCycle(ctx, tx!, input.id, input.role);
    return { success: true, cycle };
  },
});
