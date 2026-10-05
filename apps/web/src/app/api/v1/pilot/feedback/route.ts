import { z } from 'zod';
import { createNextRoute, PilotService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const pilotService = new PilotService();

const createFeedbackSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  category: z.string().default('general'),
  pageContext: z.string().optional().nullable(),
  message: z.string().min(1).max(2000),
});

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.FEEDBACK_READ,
  skipTenantTransaction: true,
  schema: z.object({}),
  handler: async (_query, ctx) => {
    const list = await pilotService.listFeedback(ctx);
    return { data: list };
  },
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.FEEDBACK_CREATE,
  skipTenantTransaction: true,
  schema: createFeedbackSchema,
  handler: async (body, ctx) => {
    const submission = await pilotService.submitFeedback(ctx, body);
    return { data: submission };
  },
});
