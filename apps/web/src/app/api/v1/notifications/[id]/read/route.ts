import { z } from 'zod';
import { createNextRoute, NotificationService } from '@hrms/core';

const notificationService = new NotificationService();

const markReadSchema = z.object({
  id: z.string().uuid('Notification ID must be a valid UUID.'),
});

export const PATCH = createNextRoute({
  requireAuth: true,
  schema: markReadSchema,
  handler: async (input, ctx) => {
    const res = await notificationService.markAsRead(ctx, input.id);
    return { data: res };
  },
});
