import { z } from 'zod';

export const biometricPunchItemSchema = z.object({
  biometricUserId: z.string().min(1, 'Biometric user ID is required'),
  punchTime: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/)),
  punchType: z.enum(['in', 'out', 'auto']).default('auto'),
  rawRecordId: z.string().optional(),
});

export const biometricIngestBatchSchema = z.object({
  deviceId: z.string().min(1, 'Device ID is required'),
  punches: z.array(biometricPunchItemSchema).min(1, 'At least one punch required').max(500),
});

export type BiometricPunchItem = z.infer<typeof biometricPunchItemSchema>;
export type BiometricIngestBatchInput = z.infer<typeof biometricIngestBatchSchema>;
