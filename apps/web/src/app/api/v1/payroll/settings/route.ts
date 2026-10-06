import { z } from 'zod';
import { createNextRoute, PayrollSettingsService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const settingsService = new PayrollSettingsService();

const updateSettingsSchema = z.object({
  legalEntityId: z.string().uuid().optional(),
  payCycle: z.enum(['monthly']).default('monthly'),
  payDay: z.number().int().min(1).max(31).default(30),
  paidDaysBasis: z.enum(['calendar', 'fixed_30', 'working_days']).default('calendar'),
  prorationMode: z.enum(['prorate_earnings', 'deduct_lop']).default('prorate_earnings'),
  fyStartMonth: z.number().int().min(1).max(12).default(4),
  labourCodeWages: z
    .object({
      enabled: z.boolean(),
      floorPct: z.number().min(0).max(100),
    })
    .default({ enabled: true, floorPct: 50 }),
  pfEnabled: z.boolean().default(true),
  esiEnabled: z.boolean().default(true),
  ptEnabled: z.boolean().default(true),
  lwfEnabled: z.boolean().default(true),
  negativeNetPolicy: z.enum(['block', 'hold', 'carry_forward']).default('block'),
});

export const GET = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_SETTINGS_READ,
  handler: async (_req, ctx, tx) => {
    const data = await settingsService.getSettingsAndEntities(ctx, tx!);
    return { data };
  },
});

export const POST = createNextRoute({
  requireAuth: true,
  permission: PERMISSIONS.PAYROLL_SETTINGS_MANAGE,
  schema: updateSettingsSchema,
  handler: async (body, ctx, tx) => {
    const data = await settingsService.saveSettings(ctx, tx!, body);
    return { data };
  },
});
