import { z } from 'zod';
import { createNextRoute, NotificationService } from '@hrms/core';

const notificationService = new NotificationService();

const queryNotificationsRouteSchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const GET = createNextRoute({
  requireAuth: true,
  schema: queryNotificationsRouteSchema,
  handler: async (input, ctx) => {
    const res = await notificationService.listNotifications(ctx, input);
    return { data: res.items, nextCursor: res.nextCursor };
  },
});
