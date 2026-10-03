import { z } from 'zod';
import { createNextRoute, NotificationService } from '@hrms/core';

const notificationService = new NotificationService();

export const POST = createNextRoute({
  requireAuth: true,
  schema: z.object({}),
  handler: async (_input, ctx) => {
    const res = await notificationService.markAllAsRead(ctx);
    return { data: res };
  },
});
