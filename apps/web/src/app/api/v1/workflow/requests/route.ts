import { z } from 'zod';
import { createNextRoute, WorkflowService } from '@hrms/core';

const workflowService = new WorkflowService();

const submitRequestSchema = z.object({
  definitionCode: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
  metadata: z.record(z.unknown()).optional(),
});

export const POST = createNextRoute({
  requireAuth: true,
  skipTenantTransaction: true,
  schema: submitRequestSchema,
  handler: async (input, ctx) => {
    const result = await workflowService.submitRequest(ctx, {
      ...input,
      payload: input.payload ?? {},
    });
    return { data: result, statusCode: 201 };
  },
});
