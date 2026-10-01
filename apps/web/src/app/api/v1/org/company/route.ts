import { z } from 'zod';
import { createNextRoute, OrgService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const orgService = new OrgService();

export const GET = createNextRoute({
  permission: PERMISSIONS.ORG_COMPANY_READ,
  handler: async (_input, ctx) => {
    const company = await orgService.getCompany(ctx);
    return { data: company };
  },
});

const updateCompanySchema = z.object({
  name: z.string().min(1).optional(),
  legalName: z.string().min(1).optional(),
  logoUrl: z.string().url().nullable().optional(),
});

export const PUT = createNextRoute({
  permission: PERMISSIONS.ORG_COMPANY_UPDATE,
  schema: updateCompanySchema,
  handler: async (input, ctx) => {
    const company = await orgService.updateCompany(ctx, input);
    return { data: company };
  },
});
