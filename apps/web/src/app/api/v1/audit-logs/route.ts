import { z } from 'zod';
import { createNextRoute, AuditService } from '@hrms/core';

const auditService = new AuditService();

const queryAuditLogsSchema = z.object({
  entity: z.string().optional(),
  entityId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  action: z.string().optional(),
  cursorTs: z.string().optional(),
  cursorId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const GET = createNextRoute({
  requireAuth: true,
  schema: queryAuditLogsSchema,
  handler: async (input, ctx) => {
    return auditService.queryLogs(ctx, input);
  },
});
