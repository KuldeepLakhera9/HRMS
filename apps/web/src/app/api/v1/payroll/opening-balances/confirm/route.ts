import { z } from 'zod';
import { createNextRoute, OpeningBalanceService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const openingBalanceService = new OpeningBalanceService();

const confirmSchema = z.object({
  records: z.array(
    z.object({
      employeeId: z.string().uuid(),
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
  schema: confirmSchema,
  handler: async (input, ctx, tx) => {
    const result = await openingBalanceService.confirmImport(ctx, tx!, input.records);
    return { success: true, ...result };
  },
});
