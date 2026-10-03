import { z } from 'zod';
import { createNextRoute, OrgService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const orgService = new OrgService();

const getOrgChartSchema = z.object({
  parentId: z.string().optional(),
  search: z.string().optional(),
});

export const GET = createNextRoute({
  permission: PERMISSIONS.ORG_CHART_READ,
  schema: getOrgChartSchema,
  handler: async (input, ctx) => {
    if (input.search && input.search.trim()) {
      const results = await orgService.searchOrgChart(ctx, input.search.trim());
      return { data: results };
    }
    const nodes = await orgService.getOrgChart(ctx, input.parentId);
    return { data: nodes };
  },
});
