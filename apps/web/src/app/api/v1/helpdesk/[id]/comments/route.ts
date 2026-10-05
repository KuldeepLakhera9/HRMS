import { z } from 'zod';
import { createNextRoute, HelpdeskService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const helpdeskService = new HelpdeskService();

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.HELPDESK_TICKET_READ,
  skipTenantTransaction: true,
  schema: z.object({
    id: z.string().uuid(),
    commentMd: z.string().min(1).max(10000),
    isInternal: z.boolean().default(false),
  }),
  handler: async (body, ctx) => {
    const comment = await helpdeskService.addComment(ctx, body.id, {
      commentMd: body.commentMd,
      isInternal: body.isInternal,
    });
    return { data: comment };
  },
});
