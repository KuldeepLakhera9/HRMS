import { z } from 'zod';
import { createNextRoute, WorkflowService } from '@hrms/core';

const workflowService = new WorkflowService();

const inboxQuerySchema = z.object({
  status: z.enum(['pending', 'acted', 'cancelled']).default('pending'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursorCreatedAt: z.string().optional(),
  cursorId: z.string().optional(),
});

export const GET = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: inboxQuerySchema,
  handler: async (input, ctx) => {
    const result = await workflowService.getInbox(ctx, input);
    return { data: result.items, nextCursor: result.nextCursor };
  },
});
