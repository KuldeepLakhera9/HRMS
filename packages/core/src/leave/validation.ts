import { z } from 'zod';

export const LeavePartEnum = z.enum(['full', 'first', 'second']);
export const LeaveRequestStatusEnum = z.enum(['pending', 'approved', 'rejected', 'withdrawn', 'cancelled']);

export const PreviewLeaveSchema = z.object({
  employeeId: z.string().uuid().optional(),
  leaveTypeId: z.string().uuid(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be formatted as YYYY-MM-DD'),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be formatted as YYYY-MM-DD'),
  fromPart: LeavePartEnum.optional(),
  toPart: LeavePartEnum.optional(),
  hours: z.number().min(0.5).max(12).optional(),
});

export type PreviewLeaveInputDto = z.infer<typeof PreviewLeaveSchema>;

export const SubmitLeaveRequestSchema = PreviewLeaveSchema.extend({
  reason: z.string().min(1, 'Reason is required').max(1000),
  documentFileId: z.string().uuid().nullable().optional(),
  idempotencyKey: z.string().max(100).optional(),
});

export type SubmitLeaveRequestDto = z.infer<typeof SubmitLeaveRequestSchema>;

export const ListLeaveRequestsQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  status: LeaveRequestStatusEnum.optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export type ListLeaveRequestsQueryDto = z.infer<typeof ListLeaveRequestsQuerySchema>;

export const CancelLeaveRequestSchema = z.object({
  reason: z.string().min(1, 'Reason is required for cancellation').max(500),
});

export type CancelLeaveRequestDto = z.infer<typeof CancelLeaveRequestSchema>;

export const RejectLeaveRequestSchema = z.object({
  reason: z.string().min(1, 'Reason is required for rejection').max(500),
});

export type RejectLeaveRequestDto = z.infer<typeof RejectLeaveRequestSchema>;

export const AdjustBalanceSchema = z.object({
  employeeId: z.string().uuid(),
  leaveTypeId: z.string().uuid(),
  amount: z.number(),
  reason: z.string().min(1, 'Reason is required').max(500),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export type AdjustBalanceDto = z.infer<typeof AdjustBalanceSchema>;

export const ListBalancesQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export type ListBalancesQueryDto = z.infer<typeof ListBalancesQuerySchema>;

export const LeaveCalendarScopeEnum = z.enum(['team', 'department', 'company']);

export const LeaveCalendarQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be formatted as YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be formatted as YYYY-MM-DD'),
  scope: LeaveCalendarScopeEnum.default('company'),
  scopeId: z.string().uuid().optional(),
});

export type LeaveCalendarQueryDto = z.infer<typeof LeaveCalendarQuerySchema>;

export const HolidayQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  locationId: z.string().uuid().optional(),
});

export type HolidayQueryDto = z.infer<typeof HolidayQuerySchema>;

export const CreateHolidayListSchema = z.object({
  name: z.string().min(1).max(100),
  year: z.number().int().min(2000).max(2100),
  description: z.string().max(500).optional(),
});

export type CreateHolidayListDto = z.infer<typeof CreateHolidayListSchema>;

export const CreateHolidaySchema = z.object({
  holidayListId: z.string().uuid(),
  name: z.string().min(1).max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isOptional: z.boolean().optional(),
  description: z.string().max(500).optional(),
});

export type CreateHolidayDto = z.infer<typeof CreateHolidaySchema>;
