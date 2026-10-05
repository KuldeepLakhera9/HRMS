import { z } from 'zod';

export const RegularizationRequestTypeEnum = z.enum([
  'punch_missing',
  'in_time_change',
  'out_time_change',
  'on_duty',
  'work_from_home',
]);

export type RegularizationRequestType = z.infer<typeof RegularizationRequestTypeEnum>;

export const RegularizationStatusEnum = z.enum(['pending', 'approved', 'rejected', 'cancelled']);

export type RegularizationStatus = z.infer<typeof RegularizationStatusEnum>;

export const CreateRegularizationInputSchema = z.object({
  employeeId: z.string().uuid().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be formatted as YYYY-MM-DD'),
  requestType: RegularizationRequestTypeEnum,
  inTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'inTime must be formatted as HH:MM or HH:MM:SS')
    .optional(),
  outTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'outTime must be formatted as HH:MM or HH:MM:SS')
    .optional(),
  reason: z.string().min(5, 'Reason must be at least 5 characters').max(500),
});

export type CreateRegularizationInput = z.infer<typeof CreateRegularizationInputSchema>;

export const ListRegularizationsQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  status: RegularizationStatusEnum.optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export type ListRegularizationsQuery = z.infer<typeof ListRegularizationsQuerySchema>;

export const DecideRegularizationInputSchema = z.object({
  action: z.enum(['approve', 'reject']),
  comments: z.string().max(500).optional(),
});

export type DecideRegularizationInput = z.infer<typeof DecideRegularizationInputSchema>;
