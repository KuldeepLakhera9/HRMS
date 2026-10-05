import { z } from 'zod';
import { createNextRoute, MigrationService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const migrationService = new MigrationService();

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.IMPORT_ATTENDANCE,
  skipTenantTransaction: true,
  schema: z.object({
    batchId: z.string().uuid(),
  }),
  handler: async (body, ctx) => {
    const result = await migrationService.confirmAttendance(ctx, body.batchId);
    return { data: result };
  },
});
