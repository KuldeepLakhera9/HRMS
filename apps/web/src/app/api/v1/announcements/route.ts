import { z } from 'zod';
import { createNextRoute, AnnouncementService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const announcementService = new AnnouncementService();

const createAnnouncementSchema = z.object({
  title: z.string().min(1).max(200),
  contentMd: z.string().min(1),
  audienceType: z.enum(['all', 'department', 'location']).default('all'),
  targetDeptId: z.string().uuid().optional().nullable(),
  targetLocId: z.string().uuid().optional().nullable(),
  isPinned: z.boolean().default(false),
  publishedAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional().nullable(),
});

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.ANNOUNCEMENT_READ,
  skipTenantTransaction: true,
  schema: z.object({
    includeExpired: z.coerce.boolean().optional(),
    departmentId: z.string().uuid().optional(),
  }),
  handler: async (query, ctx) => {
    const list = await announcementService.listAnnouncements(ctx, query);
    return { data: list };
  },
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.ANNOUNCEMENT_MANAGE,
  skipTenantTransaction: true,
  schema: createAnnouncementSchema,
  handler: async (body, ctx) => {
    const announcement = await announcementService.createAnnouncement(ctx, body);
    return { data: announcement };
  },
});
