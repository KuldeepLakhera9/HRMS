import { z } from 'zod';
import { createNextRoute, OpeningBalanceService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const openingBalanceService = new OpeningBalanceService();

const previewSchema = z.object({
  rows: z.array(
    z.object({
      empCode: z.string(),
      fy: z.string(),
      asOfPeriod: z.string(),
      componentCode: z.string(),
      amount: z.union([z.number(), z.string()]),
      tdsDeducted: z.union([z.number(), z.string()]).optional(),
      pfYtd: z.union([z.number(), z.string()]).optional(),
      esiYtd: z.union([z.number(), z.string()]).optional(),
      ptYtd: z.union([z.number(), z.string()]).optional(),
    }),
  ),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_SETTINGS_MANAGE,
  schema: previewSchema,
  handler: async (input, ctx, tx) => {
    const result = await openingBalanceService.validateAndPreview(ctx, tx!, input.rows);
    return { success: true, ...result };
  },
});
