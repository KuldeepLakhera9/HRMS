import { z } from 'zod';
import { createNextRoute, DashboardService } from '@hrms/core';

const dashboardService = new DashboardService();
const emptyQuerySchema = z.object({});

export const GET = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: emptyQuerySchema,
  handler: async (_input, ctx) => {
    const metrics = await dashboardService.getMetrics(ctx);
    return { data: metrics };
  },
});
