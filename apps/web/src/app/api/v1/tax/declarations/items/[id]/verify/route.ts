import { z } from 'zod';
import { createNextRoute, TaxDeclarationService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const taxService = new TaxDeclarationService();

const verifyItemSchema = z.object({
  id: z.string().uuid(),
  proofStatus: z.enum(['verified', 'rejected']),
  amountVerified: z.union([z.number(), z.string()]),
  notes: z.string().optional(),
  rejectionReason: z.string().optional(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.TAX_DECLARATION_VERIFY,
  schema: verifyItemSchema,
  handler: async (input, ctx, tx) => {
    const { id, ...data } = input;
    const item = await taxService.verifyDeclarationItem(ctx, tx!, id, data);
    return { success: true, item };
  },
});
