import { z } from 'zod';
import { createNextRoute, PayslipPdfService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const pdfService = new PayslipPdfService();

const downloadPayslipSchema = z.object({
  id: z.string().uuid(),
});

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_PAYSLIP_VIEW_SELF,
  schema: downloadPayslipSchema,
  handler: async (params, ctx, tx) => {
    const result = await pdfService.getDownloadUrl(ctx, tx!, params.id);
    return { data: result };
  },
});
