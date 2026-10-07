import { z } from 'zod';
import { createNextRoute, OpeningBalanceService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const openingBalanceService = new OpeningBalanceService();

const revertSchema = z.object({
  importJobId: z.string().uuid(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_SETTINGS_MANAGE,
  schema: revertSchema,
  handler: async (input, ctx, tx) => {
    const result = await openingBalanceService.revertImport(ctx, tx!, input.importJobId);
    return { success: true, ...result };
  },
});
