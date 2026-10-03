import { z } from 'zod';
import { createNextRoute, NotificationService } from '@hrms/core';

const notificationService = new NotificationService();

export const GET = createNextRoute({
  requireAuth: true,
  schema: z.object({}),
  handler: async (_input, ctx) => {
    const prefs = await notificationService.getPreferences(ctx);
    return { data: prefs };
  },
});

const updatePreferencesRouteSchema = z.object({
  channels: z.object({
    in_app: z.boolean().default(true),
    email: z.boolean().default(true),
  }),
});

export const PUT = createNextRoute({
  requireAuth: true,
  schema: updatePreferencesRouteSchema,
  handler: async (input, ctx) => {
    const updated = await notificationService.updatePreferences(ctx, input.channels);
    return { data: updated };
  },
});
