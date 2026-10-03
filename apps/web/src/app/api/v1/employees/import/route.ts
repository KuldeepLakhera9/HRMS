import { z } from 'zod';
import { createNextRoute, BulkService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const bulkService = new BulkService();

const validateImportSchema = z.object({
  csvContent: z.string().min(1, 'CSV content cannot be empty.'),
  entity: z.enum(['employee']).default('employee'),
});

export const POST = createNextRoute({
  permission: PERMISSIONS.EMPLOYEE_PROFILE_IMPORT,
  schema: validateImportSchema,
  handler: async (input, ctx) => {
    const result = await bulkService.validateImport(ctx, input.csvContent, input.entity);
    return { data: result };
  },
});
