import { z } from 'zod';

export const registerDeviceSchema = z.object({
  employeeId: z.string().uuid().optional(),
  deviceId: z.string().min(1).max(128),
  deviceModel: z.string().min(1).max(128),
  osName: z.string().min(1).max(64),
  osVersion: z.string().min(1).max(64),
  appVersion: z.string().min(1).max(64),
});

export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

export const attestDeviceSchema = z.object({
  deviceId: z.string().min(1).max(128),
  platform: z.enum(['android', 'ios']),
  token: z.string().min(1),
  packageName: z.string().optional(),
  keyId: z.string().optional(),
  challenge: z.string().optional(),
});

export type AttestDeviceInput = z.infer<typeof attestDeviceSchema>;
