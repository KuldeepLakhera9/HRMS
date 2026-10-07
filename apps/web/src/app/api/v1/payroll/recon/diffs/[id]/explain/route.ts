import { z } from 'zod';
import { createNextRoute, ReconciliationService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const reconService = new ReconciliationService();

const explainSchema = z.object({
  id: z.string().uuid(),
  explanation: z.string(),
  category: z.enum(['rounding', 'rule_difference', 'input_difference', 'engine_bug', 'source_error', 'timing']).optional(),
  status: z.enum(['explained', 'accepted', 'fixed']).optional(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RECON_MANAGE,
  schema: explainSchema,
  handler: async (input, ctx, tx) => {
    const { id, ...data } = input;
    const diff = await reconService.explainDiff(ctx, tx!, id, data);
    return { success: true, diff };
  },
});
