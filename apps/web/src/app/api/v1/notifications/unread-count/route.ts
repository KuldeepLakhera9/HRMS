import { z } from 'zod';
import { createNextRoute, NotificationService } from '@hrms/core';

const notificationService = new NotificationService();

export const GET = createNextRoute({
  requireAuth: true,
  schema: z.object({}),
  handler: async (_input, ctx) => {
    const unreadCount = await notificationService.getUnreadCount(ctx);
    return { data: { unreadCount } };
  },
});
