import { z } from 'zod';
import { createNextRoute, StatutoryRulesService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const rulesService = new StatutoryRulesService();

const createRuleSetSchema = z.object({
  key: z.string().min(1).max(50),
  jurisdiction: z.string().min(1).max(10),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  payload: z.record(z.unknown()),
  sourceNote: z.string().optional(),
  testCases: z.array(z.record(z.unknown())).optional(),
});

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RULES_READ,
  schema: z.object({
    key: z.string().optional(),
    jurisdiction: z.string().optional(),
  }),
  handler: async (query, ctx, tx) => {
    if (query.key && query.jurisdiction) {
      const list = await rulesService.listVersions(ctx, tx!, query.key, query.jurisdiction);
      return { data: list };
    }
    // List all
    const all = await rulesService.listVersions(ctx, tx!, query.key || 'PF_IN', query.jurisdiction || 'IN');
    return { data: all };
  },
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RULES_MANAGE,
  schema: createRuleSetSchema,
  handler: async (body, ctx, tx) => {
    const created = await rulesService.createDraftRuleSet(ctx, tx!, body);
    return { data: created };
  },
});
