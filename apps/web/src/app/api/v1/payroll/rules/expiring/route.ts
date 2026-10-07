import { z } from 'zod';
import { createNextRoute, StatutoryRulesService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const rulesService = new StatutoryRulesService();

const expiringRulesSchema = z.object({
  horizonDays: z.coerce.number().default(60),
}).optional();

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RULES_READ,
  schema: expiringRulesSchema,
  handler: async (input, ctx, tx) => {
    const expiring = await rulesService.getExpiringRules(ctx, tx!, input?.horizonDays || 60);
    return { success: true, expiring };
  },
});
