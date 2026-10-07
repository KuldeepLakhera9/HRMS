import { z } from 'zod';
import { createNextRoute, StatutoryFilingService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const statutoryService = new StatutoryFilingService();

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_STATUTORY_GENERATE,
  schema: z.object({}).optional(),
  handler: async (_input, _ctx) => {
    const calendar = statutoryService.getDueCalendar();
    return { success: true, calendar };
  },
});
