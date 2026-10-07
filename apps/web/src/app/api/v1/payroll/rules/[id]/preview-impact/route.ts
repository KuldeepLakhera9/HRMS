import { z } from 'zod';
import { createNextRoute, StatutoryRulesService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const rulesService = new StatutoryRulesService();

const previewImpactSchema = z.object({
  id: z.string().uuid(),
  sampleCohortSize: z.number().default(5).optional(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RULES_READ,
  schema: previewImpactSchema,
  handler: async (input, ctx, tx) => {
    const result = await rulesService.previewRuleImpact(ctx, tx!, input.id, input.sampleCohortSize || 5);
    return { success: true, ...result };
  },
});
