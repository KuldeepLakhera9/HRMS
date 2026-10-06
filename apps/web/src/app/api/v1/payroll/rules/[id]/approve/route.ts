import { z } from 'zod';
import { createNextRoute, StatutoryRulesService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const rulesService = new StatutoryRulesService();

const approveRuleSchema = z.object({
  id: z.string().uuid(),
  caVerifiedBy: z.string().optional(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RULES_APPROVE,
  schema: approveRuleSchema,
  handler: async (body, ctx, tx) => {
    const activated = await rulesService.approveAndActivate(
      ctx,
      tx!,
      body.id,
      body.caVerifiedBy ? { caVerifiedBy: body.caVerifiedBy } : undefined,
    );
    return { data: activated };
  },
});
