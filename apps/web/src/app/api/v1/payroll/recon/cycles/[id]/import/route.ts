import { z } from 'zod';
import { createNextRoute, ReconciliationService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const reconService = new ReconciliationService();

const importLegacySchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  columnMapping: z.record(z.string(), z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_RECON_MANAGE,
  schema: importLegacySchema,
  handler: async (input, ctx, tx) => {
    const { id, ...dto } = input;
    const result = await reconService.importAndCompare(ctx, tx!, id, dto);
    return { success: true, ...result };
  },
});
