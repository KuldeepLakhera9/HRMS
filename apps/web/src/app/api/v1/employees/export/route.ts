import { z } from 'zod';
import { createNextRoute, BulkService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const bulkService = new BulkService();

const exportSchema = z.object({
  includeSensitive: z.coerce.boolean().optional().default(false),
});

export const GET = createNextRoute({
  permission: PERMISSIONS.EMPLOYEE_PROFILE_EXPORT,
  schema: exportSchema,
  handler: async (input, ctx) => {
    const csv = await bulkService.exportEmployeesCsv(ctx, {
      includeSensitive: input.includeSensitive,
    });

    return {
      __headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="employees_export.csv"',
      },
      csv,
    };
  },
});
