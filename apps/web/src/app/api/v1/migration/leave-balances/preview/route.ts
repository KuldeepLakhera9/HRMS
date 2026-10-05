import { z } from 'zod';
import { createNextRoute, MigrationService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const migrationService = new MigrationService();

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.IMPORT_LEAVE_BALANCES,
  skipTenantTransaction: true,
  schema: z.object({
    csvContent: z.string().min(1, 'CSV content is required'),
  }),
  handler: async (body, ctx) => {
    const preview = await migrationService.previewLeaveBalances(ctx, body.csvContent);
    return { data: preview };
  },
});
