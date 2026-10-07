import { z } from 'zod';
import { createNextRoute, StatutoryFilingService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const statutoryService = new StatutoryFilingService();

const tdsSchema = z.object({
  id: z.string().uuid(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_STATUTORY_GENERATE,
  schema: tdsSchema,
  handler: async (input, ctx, tx) => {
    const result = await statutoryService.generateTdsReturnData(ctx, tx!, input.id);
    return { success: true, ...result };
  },
});
