import { z } from 'zod';
import { createNextRoute, TaxDeclarationService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const taxService = new TaxDeclarationService();

const submitDeclarationSchema = z.object({
  id: z.string().uuid(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.TAX_DECLARATION_SUBMIT,
  schema: submitDeclarationSchema,
  handler: async (input, ctx, tx) => {
    const declaration = await taxService.submitDeclaration(ctx, tx!, input.id);
    return { success: true, declaration };
  },
});
