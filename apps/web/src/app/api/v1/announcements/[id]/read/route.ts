import { z } from 'zod';
import { createNextRoute, AnnouncementService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const announcementService = new AnnouncementService();

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.ANNOUNCEMENT_READ,
  skipTenantTransaction: true,
  schema: z.object({
    id: z.string().uuid(),
  }),
  handler: async (params, ctx) => {
    const result = await announcementService.markAsRead(ctx, params.id);
    return { data: result };
  },
});
