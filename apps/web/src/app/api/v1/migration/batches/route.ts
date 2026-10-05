import { z } from 'zod';
import { createNextRoute, MigrationService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const migrationService = new MigrationService();

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.IMPORT_LEAVE_BALANCES,
  skipTenantTransaction: true,
  schema: z.object({}),
  handler: async (_query, ctx) => {
    const batches = await migrationService.listBatches(ctx);
    return { data: batches };
  },
});
