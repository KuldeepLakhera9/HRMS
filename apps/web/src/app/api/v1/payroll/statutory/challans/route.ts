import { z } from 'zod';
import { createNextRoute, StatutoryFilingService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const statutoryService = new StatutoryFilingService();

const linkChallanSchema = z.object({
  filingId: z.string().uuid(),
  challanReference: z.string(),
  challanDate: z.string(),
  challanAmount: z.union([z.number(), z.string()]),
  notes: z.string().optional(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_STATUTORY_GENERATE,
  schema: linkChallanSchema,
  handler: async (input, ctx, tx) => {
    const filing = await statutoryService.linkChallan(ctx, tx!, input.filingId, input);
    return { success: true, filing };
  },
});
