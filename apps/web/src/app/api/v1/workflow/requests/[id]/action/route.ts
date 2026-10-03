import { z } from 'zod';
import { createNextRoute, WorkflowService } from '@hrms/core';

const workflowService = new WorkflowService();

const executeActionSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(['approve', 'reject', 'delegate']),
  comments: z.string().max(1000).nullable().optional(),
  delegateeId: z.string().uuid().nullable().optional(),
});

export const POST = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: executeActionSchema,
  handler: async (input, ctx) => {
    const result = await workflowService.executeAction(ctx, {
      requestId: input.id,
      action: input.action,
      comments: input.comments,
      delegateeId: input.delegateeId,
    });
    return { data: result };
  },
});
