import { z } from 'zod';
import { createNextRoute, BulkService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const bulkService = new BulkService();

const confirmImportSchema = z.object({
  id: z.string().uuid(),
  csvContent: z.string().min(1, 'CSV content cannot be empty.'),
});

export const POST = createNextRoute({
  permission: PERMISSIONS.EMPLOYEE_PROFILE_IMPORT,
  schema: confirmImportSchema,
  handler: async (input, ctx) => {
    const result = await bulkService.confirmImport(ctx, input.id, input.csvContent);
    return { data: result };
  },
});
