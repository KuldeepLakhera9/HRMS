import { z } from 'zod';
import { createNextRoute, TaxDeclarationService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const taxService = new TaxDeclarationService();

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.TAX_DECLARATION_SUBMIT,
  schema: z.object({}).optional(),
  handler: async (_input, ctx, tx) => {
    const catalog = await taxService.getDeductionCatalog(ctx, tx!);
    return { success: true, catalog };
  },
});
