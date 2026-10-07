import { z } from 'zod';
import { createNextRoute, TaxDeclarationService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const taxService = new TaxDeclarationService();

const regimeCompareSchema = z.object({
  grossAnnual: z.union([z.number(), z.string()]),
  deductions: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
  previousEmployerEarnings: z.union([z.number(), z.string()]).optional(),
  previousEmployerTds: z.union([z.number(), z.string()]).optional(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.TAX_REGIME_COMPARE,
  schema: regimeCompareSchema,
  handler: async (input, ctx, tx) => {
    const comparison = await taxService.compareRegimes(ctx, tx!, input);
    return { success: true, ...comparison };
  },
});
