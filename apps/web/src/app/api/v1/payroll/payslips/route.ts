import { z } from 'zod';
import { createNextRoute, PayslipPdfService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const pdfService = new PayslipPdfService();

const listPayslipsSchema = z.object({
  employeeId: z.string().uuid().optional(),
  period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_PAYSLIP_VIEW_SELF,
  schema: listPayslipsSchema,
  handler: async (query, ctx, tx) => {
    const result = await pdfService.listPayslips(ctx, tx!, {
      employeeId: query.employeeId,
      period: query.period,
      limit: query.limit,
      offset: query.offset,
    });
    return { data: result };
  },
});
