import { z } from 'zod';
import { createNextRoute, PilotService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const pilotService = new PilotService();

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PILOT_METRICS_READ,
  skipTenantTransaction: true,
  schema: z.object({
    departmentId: z.string().uuid().optional(),
  }),
  handler: async (query, ctx) => {
    const metrics = await pilotService.getPilotMetrics(ctx, query.departmentId);
    return { data: metrics };
  },
});
