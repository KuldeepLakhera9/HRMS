import { z } from 'zod';
import { createNextRoute, StatutoryRulesService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const rulesService = new StatutoryRulesService();

const getActiveRuleSchema = z.object({
  key: z.string().min(1),
  jurisdiction: z.string().min(1),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RULES_READ,
  schema: getActiveRuleSchema,
  handler: async (query, ctx, tx) => {
    const active = await rulesService.getActiveRuleSet(
      ctx,
      tx!,
      query.key,
      query.jurisdiction,
      query.asOfDate,
    );
    return { data: active };
  },
});
