import { z } from 'zod';
import { createNextRoute, ReportService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const reportService = new ReportService();

const previewReportSchema = z.object({
  key: z.string().min(1),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(5000).default(50),
  filters: z.record(z.string(), z.unknown()).default({}),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.REPORT_RUN,
  skipTenantTransaction: true,
  schema: previewReportSchema,
  handler: async (input, ctx) => {
    const result = await reportService.preview(
      ctx,
      input.key,
      input.filters ?? {},
      { page: input.page, pageSize: input.pageSize }
    );
    return { data: result };
  },
});
