import { z } from 'zod';
import { createNextRoute, OrgService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const orgService = new OrgService();

export const GET = createNextRoute({
  permission: PERMISSIONS.ORG_COSTCENTER_READ,
  handler: async (_input, ctx) => {
    const costCenters = await orgService.listCostCenters(ctx);
    return { data: costCenters };
  },
});

const createCostCenterSchema = z.object({
  name: z.string().min(1, 'Cost center name is required.'),
  code: z.string().min(1, 'Cost center code is required.').max(20),
  active: z.boolean().optional(),
});

export const POST = createNextRoute({
  permission: PERMISSIONS.ORG_COSTCENTER_MANAGE,
  schema: createCostCenterSchema,
  handler: async (input, ctx) => {
    const costCenter = await orgService.createCostCenter(ctx, input);
    return { data: costCenter };
  },
});
