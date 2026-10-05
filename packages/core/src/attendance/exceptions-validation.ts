import { z } from 'zod';

export const listExceptionsSchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be YYYY-MM-DD')
    .optional(),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be YYYY-MM-DD')
    .optional(),
  employeeId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  exceptionType: z
    .enum(['all', 'missing_punch', 'short_hours', 'late_in', 'early_out', 'unexcused_absence'])
    .default('all'),
  isRegularized: z
    .union([z.boolean(), z.enum(['true', 'false']).transform(v => v === 'true')])
    .optional(),
  cursorWorkDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  cursorId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type ListExceptionsInput = z.infer<typeof listExceptionsSchema>;

export const bulkResolveExceptionsSchema = z.object({
  dayIds: z.array(z.string().uuid()).min(1, 'At least one day ID required').max(100),
  action: z.enum(['excuse', 'regularize', 'mark_present']),
  comments: z.string().max(500).optional(),
});

export type BulkResolveExceptionsInput = z.infer<typeof bulkResolveExceptionsSchema>;

export const calendarMonthSchema = z.object({
  employeeId: z.string().uuid().optional(),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'month must be formatted YYYY-MM'),
});

export type CalendarMonthInput = z.infer<typeof calendarMonthSchema>;
