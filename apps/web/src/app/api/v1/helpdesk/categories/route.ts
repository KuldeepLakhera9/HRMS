import { z } from 'zod';
import { createNextRoute, HelpdeskService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const helpdeskService = new HelpdeskService();

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.HELPDESK_TICKET_READ,
  skipTenantTransaction: true,
  schema: z.object({}),
  handler: async (_query, ctx) => {
    const categories = await helpdeskService.listCategories(ctx);
    return { data: categories };
  },
});
