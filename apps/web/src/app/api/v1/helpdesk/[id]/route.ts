import { z } from 'zod';
import { createNextRoute, HelpdeskService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const helpdeskService = new HelpdeskService();

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.HELPDESK_TICKET_READ,
  skipTenantTransaction: true,
  schema: z.object({
    id: z.string().uuid(),
  }),
  handler: async (params, ctx) => {
    const result = await helpdeskService.getTicket(ctx, params.id);
    return { data: result };
  },
});

export const PATCH = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.HELPDESK_TICKET_MANAGE,
  skipTenantTransaction: true,
  schema: z.object({
    id: z.string().uuid(),
    status: z.enum(['open', 'in_progress', 'resolved', 'closed']),
  }),
  handler: async (body, ctx) => {
    const updated = await helpdeskService.updateTicketStatus(ctx, body.id, body.status);
    return { data: updated };
  },
});
