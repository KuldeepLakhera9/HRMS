import { z } from 'zod';
import { createNextRoute, ReportService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const reportService = new ReportService();

const exportReportSchema = z.object({
  key: z.string().min(1),
  format: z.enum(['csv', 'xlsx']).default('csv'),
  filters: z.record(z.string(), z.unknown()).default({}),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.REPORT_EXPORT,
  skipTenantTransaction: true,
  schema: exportReportSchema,
  handler: async (input, ctx) => {
    const result = await reportService.export(
      ctx,
      input.key,
      input.filters ?? {},
      input.format
    );
    return { data: result };
  },
});
