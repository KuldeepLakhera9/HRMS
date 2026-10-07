import { z } from 'zod';
import { createNextRoute, StatutoryFilingService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const statutoryService = new StatutoryFilingService();

const ecrSchema = z.object({
  id: z.string().uuid(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_STATUTORY_GENERATE,
  schema: ecrSchema,
  handler: async (input, ctx, tx) => {
    const result = await statutoryService.generatePfEcr(ctx, tx!, input.id);
    return { success: true, ...result };
  },
});
