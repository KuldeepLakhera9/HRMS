import { z } from 'zod';

export const reportPreviewQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(5000).default(50),
});

export const reportExportBodySchema = z.object({
  format: z.enum(['csv', 'xlsx']).default('csv'),
  filters: z.record(z.string(), z.unknown()).default({}),
});

export const reportScheduleBodySchema = z.object({
  reportKey: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  cron: z.string().min(1),
  timezone: z.string().default('UTC'),
  format: z.enum(['csv', 'xlsx']).default('csv'),
  recipients: z.array(z.string().email()),
});
