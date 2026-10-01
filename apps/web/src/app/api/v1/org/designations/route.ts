import { z } from 'zod';
import { createNextRoute, OrgService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const orgService = new OrgService();

export const GET = createNextRoute({
  permission: PERMISSIONS.ORG_DESIGNATION_READ,
  handler: async (_input, ctx) => {
    const designations = await orgService.listDesignations(ctx);
    return { data: designations };
  },
});

const createDesignationSchema = z.object({
  name: z.string().min(1, 'Designation name is required.'),
  code: z.string().min(1, 'Designation code is required.').max(20),
  active: z.boolean().optional(),
});

export const POST = createNextRoute({
  permission: PERMISSIONS.ORG_DESIGNATION_MANAGE,
  schema: createDesignationSchema,
  handler: async (input, ctx) => {
    const designation = await orgService.createDesignation(ctx, input);
    return { data: designation };
  },
});
