import { z } from 'zod';
import { createNextRoute, ReconciliationService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const reconService = new ReconciliationService();

const getDiffsSchema = z.object({
  id: z.string().uuid(),
});

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RECON_MANAGE,
  schema: getDiffsSchema,
  handler: async (input, ctx, tx) => {
    const diffs = await reconService.getCycleDiffs(ctx, tx!, input.id);
    return { success: true, diffs };
  },
});
