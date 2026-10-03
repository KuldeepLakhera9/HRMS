import { z } from 'zod';

export const createShiftSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9_-]+$/, 'Shift code must contain only uppercase letters, numbers, hyphens, and underscores'),
  name: z.string().min(1).max(100),
  startTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'startTime must be in HH:MM or HH:MM:SS format'),
  endTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'endTime must be in HH:MM or HH:MM:SS format'),
  crossesMidnight: z.boolean().default(false),
  graceMinutes: z.number().int().min(0).max(180).default(15),
  breakMinutes: z.number().int().min(0).max(360).default(60),
  workHours: z.string().regex(/^\d+(\.\d{1,2})?$/).default('8.00'),
});

export type CreateShiftInput = z.infer<typeof createShiftSchema>;

export const updateShiftSchema = createShiftSchema.partial().omit({ code: true });
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;

export const assignRosterSchema = z.object({
  employeeId: z.string().uuid(),
  shiftId: z.string().uuid(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'workDate must be in YYYY-MM-DD format'),
  isWeeklyOff: z.boolean().default(false),
  isHoliday: z.boolean().default(false),
  status: z.enum(['draft', 'published']).default('published'),
});

export type AssignRosterInput = z.infer<typeof assignRosterSchema>;

export const bulkAssignRosterSchema = z.object({
  assignments: z.array(assignRosterSchema).min(1).max(500),
});

export type BulkAssignRosterInput = z.infer<typeof bulkAssignRosterSchema>;

export const rosterQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type RosterQueryInput = z.infer<typeof rosterQuerySchema>;
