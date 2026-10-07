import { z } from 'zod';
import { createNextRoute, BankAdviceService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const bankService = new BankAdviceService();

const generateBankFileSchema = z.object({
  id: z.string().uuid(),
  templateCode: z.string().optional().default('GENERIC_NEFT'),
  reasonForRegeneration: z.string().optional(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_BANKFILE_GENERATE,
  schema: generateBankFileSchema,
  handler: async (body, ctx, tx) => {
    const result = await bankService.generateAdviceFile(ctx, tx!, body.id, {
      templateCode: body.templateCode,
      reasonForRegeneration: body.reasonForRegeneration,
    });
    return { data: result };
  },
});
