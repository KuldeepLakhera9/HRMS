import { z } from 'zod';

export const createAttendancePolicySchema = z.object({
  code: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[A-Z0-9_-]+$/, 'Policy code must contain only uppercase letters, numbers, hyphens, and underscores'),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  geofenceMode: z.enum(['strict', 'soft', 'off']).default('strict'),
  allowSelfie: z.boolean().default(false),
  requireSelfie: z.boolean().default(false),
  maxGpsAccuracyMeters: z.number().int().min(1).max(1000).default(50),
  allowedSources: z.array(z.string()).default(['mobile', 'web']),
  graceMinutes: z.number().int().min(0).max(180).default(15),
  halfDayMinutes: z.number().int().min(0).max(720).default(240),
  fullDayMinutes: z.number().int().min(0).max(1440).default(480),
  autoPunchOutHours: z.string().regex(/^\d+(\.\d)?$/).default('12.0'),
});

export type CreateAttendancePolicyInput = z.infer<typeof createAttendancePolicySchema>;

export const updateAttendancePolicySchema = createAttendancePolicySchema.partial().omit({ code: true });
export type UpdateAttendancePolicyInput = z.infer<typeof updateAttendancePolicySchema>;

export const assignAttendancePolicySchema = z
  .object({
    policyId: z.string().uuid(),
    targetType: z.enum(['employee', 'department', 'location', 'company']),
    targetId: z.string().uuid().optional(),
    validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'validFrom must be YYYY-MM-DD'),
    validTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'validTo must be YYYY-MM-DD')
      .optional(),
  })
  .refine(
    data => {
      if (data.targetType !== 'company' && !data.targetId) {
        return false;
      }
      return true;
    },
    {
      message: 'targetId is required when targetType is not company',
      path: ['targetId'],
    },
  );

export type AssignAttendancePolicyInput = z.infer<typeof assignAttendancePolicySchema>;

export const resolveAttendancePolicySchema = z.object({
  employeeId: z.string().uuid(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
    .optional(),
});
export type ResolveAttendancePolicyInput = z.infer<typeof resolveAttendancePolicySchema>;

export const lockPeriodSchema = z.object({
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'periodStart must be YYYY-MM-DD'),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'periodEnd must be YYYY-MM-DD'),
  reason: z.string().min(1, 'Reason is required').max(500),
});
export type LockPeriodSchemaInput = z.infer<typeof lockPeriodSchema>;

export const unlockPeriodSchema = z.object({
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'periodStart must be YYYY-MM-DD'),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'periodEnd must be YYYY-MM-DD'),
  reason: z.string().min(1, 'Reason is required').max(500),
});
export type UnlockPeriodSchemaInput = z.infer<typeof unlockPeriodSchema>;

export const recalculateDaySchema = z.object({
  employeeId: z.string().uuid(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'workDate must be YYYY-MM-DD'),
});
export type RecalculateDaySchemaInput = z.infer<typeof recalculateDaySchema>;
