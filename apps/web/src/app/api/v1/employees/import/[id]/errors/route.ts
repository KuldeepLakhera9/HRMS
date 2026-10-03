import { z } from 'zod';
import { createNextRoute, BulkService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const bulkService = new BulkService();

const getErrorsSchema = z.object({
  id: z.string().uuid(),
});

export const GET = createNextRoute({
  permission: PERMISSIONS.EMPLOYEE_PROFILE_IMPORT,
  schema: getErrorsSchema,
  handler: async (input, ctx) => {
    const csv = await bulkService.getErrorCsv(ctx, input.id);
    return {
      __headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="import_errors_${input.id}.csv"`,
      },
      csv,
    };
  },
});
