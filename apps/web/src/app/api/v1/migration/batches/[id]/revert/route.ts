import { z } from 'zod';
import { createNextRoute, MigrationService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const migrationService = new MigrationService();

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.IMPORT_LEAVE_BALANCES,
  skipTenantTransaction: true,
  schema: z.object({
    id: z.string().uuid(),
  }),
  handler: async (params, ctx) => {
    const result = await migrationService.revertLeaveBalances(ctx, params.id);
    return { data: result };
  },
});
