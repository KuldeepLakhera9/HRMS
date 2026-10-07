import { z } from 'zod';
import { createNextRoute, PayslipPdfService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const pdfService = new PayslipPdfService();

const reissuePayslipSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().min(5, 'Reason must be at least 5 characters'),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_PAYSLIP_REISSUE,
  schema: reissuePayslipSchema,
  handler: async (body, ctx, tx) => {
    const result = await pdfService.reissuePayslipPdf(ctx, tx!, body.id, body.reason);
    return { data: result };
  },
});
