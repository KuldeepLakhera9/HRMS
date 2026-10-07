import { z } from 'zod';
import { createNextRoute, StatutoryRulesService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const rulesService = new StatutoryRulesService();

const testRuleSchema = z.object({
  id: z.string().uuid(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RULES_READ,
  schema: testRuleSchema,
  handler: async (input, ctx, tx) => {
    const result = await rulesService.runAttachedTestCases(ctx, tx!, input.id);
    return { success: true, ...result };
  },
});
