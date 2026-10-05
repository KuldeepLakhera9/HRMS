import { z } from 'zod';
import { createNextRoute, ReportService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const reportService = new ReportService();

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.REPORT_RUN,
  skipTenantTransaction: true,
  schema: z.object({}),
  handler: async (_query, ctx) => {
    const runs = await reportService.listRuns(ctx);
    return { data: runs };
  },
});
