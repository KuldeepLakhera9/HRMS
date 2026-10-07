import { z } from 'zod';
import {
  createNextRoute,
  compareRegimes,
  StatutoryRulesService,
  type tdsRulePayloadSchema,
} from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const rulesService = new StatutoryRulesService();

const fallbackTdsRule: z.infer<typeof tdsRulePayloadSchema> = {
  financialYear: '2026-2027',
  regimes: {
    new: {
      standardDeduction: 75000,
      taxSlabs: [
        { minIncome: 0, maxIncome: 300000, ratePct: 0 },
        { minIncome: 300000, maxIncome: 700000, ratePct: 5 },
        { minIncome: 700000, maxIncome: 1000000, ratePct: 10 },
        { minIncome: 1000000, maxIncome: 1200000, ratePct: 15 },
        { minIncome: 1200000, maxIncome: 1500000, ratePct: 20 },
        { minIncome: 1500000, maxIncome: null, ratePct: 30 },
      ],
      rebate: { thresholdTaxableIncome: 700000, maxRebateAmount: 25000, marginalReliefEnabled: true },
      surchargeSlabs: [],
      healthAndEducationCessPct: 4,
      allowedDeductions: [],
    },
    old: {
      standardDeduction: 50000,
      taxSlabs: [
        { minIncome: 0, maxIncome: 250000, ratePct: 0 },
        { minIncome: 250000, maxIncome: 500000, ratePct: 5 },
        { minIncome: 500000, maxIncome: 1000000, ratePct: 20 },
        { minIncome: 1000000, maxIncome: null, ratePct: 30 },
      ],
      rebate: { thresholdTaxableIncome: 500000, maxRebateAmount: 12500, marginalReliefEnabled: false },
      surchargeSlabs: [],
      healthAndEducationCessPct: 4,
      allowedDeductions: ['80C', '80D', 'HRA'],
    },
  },
};

const compareSchema = z.object({
  annualEarnings: z.coerce.string().min(1),
  verifiedDeductions: z.record(z.coerce.string()).optional(),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_SALARY_VIEW,
  schema: compareSchema,
  handler: async (body, ctx, tx) => {
    let rule = fallbackTdsRule;
    try {
      const activeRule = await rulesService.getActiveRuleSet(
        ctx,
        tx!,
        'TDS_IN',
        'IN',
        body.asOfDate ?? new Date().toISOString().slice(0, 10),
      );
      rule = activeRule.payload as z.infer<typeof tdsRulePayloadSchema>;
    } catch {
      // Fallback to statutory standard rule if tenant has not customized TDS_IN
    }

    const comparison = compareRegimes({
      annualEarnings: body.annualEarnings,
      verifiedDeductions: body.verifiedDeductions,
      rule,
    });

    return { data: comparison };
  },
});
