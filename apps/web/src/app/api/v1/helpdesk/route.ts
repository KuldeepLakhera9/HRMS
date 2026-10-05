import { z } from 'zod';
import { createNextRoute, HelpdeskService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const helpdeskService = new HelpdeskService();

const createTicketSchema = z.object({
  categoryId: z.string().uuid(),
  subject: z.string().min(1).max(200),
  description: z.string().min(1),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
});

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.HELPDESK_TICKET_READ,
  skipTenantTransaction: true,
  schema: z.object({
    status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  }),
  handler: async (query, ctx) => {
    const tickets = await helpdeskService.listTickets(ctx, query);
    return { data: tickets };
  },
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.HELPDESK_TICKET_CREATE,
  skipTenantTransaction: true,
  schema: createTicketSchema,
  handler: async (body, ctx) => {
    const ticket = await helpdeskService.createTicket(ctx, body);
    return { data: ticket };
  },
});
