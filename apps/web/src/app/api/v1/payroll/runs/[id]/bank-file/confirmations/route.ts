import { z } from 'zod';
import { createNextRoute, BankAdviceService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const bankService = new BankAdviceService();

const importConfirmationsSchema = z.object({
  adviceFileId: z.string().uuid(),
  records: z.array(
    z.object({
      utr: z.string().min(1),
      empCode: z.string().optional(),
      accountNumber: z.string().optional(),
      amount: z.number().positive(),
      status: z.enum(['success', 'failed', 'returned']),
      failureReason: z.string().optional(),
    }),
  ),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_BANKFILE_GENERATE,
  schema: importConfirmationsSchema,
  handler: async (body, ctx, tx) => {
    const result = await bankService.importPaymentConfirmations(
      ctx,
      tx!,
      body.adviceFileId,
      body.records,
    );
    return { data: result };
  },
});
