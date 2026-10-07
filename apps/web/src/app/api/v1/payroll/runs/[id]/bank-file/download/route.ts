import { z } from 'zod';
import { createNextRoute, BankAdviceService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const bankService = new BankAdviceService();

const downloadBankFileSchema = z.object({
  adviceFileId: z.string().uuid(),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_BANKFILE_DOWNLOAD,
  schema: downloadBankFileSchema,
  handler: async (body, ctx, tx) => {
    const result = await bankService.downloadAdviceFile(ctx, tx!, body.adviceFileId, {
      requireStepUp: false,
    });
    return { data: result };
  },
});
