import { z } from 'zod';

export const PUNCH_REASON_CODES = {
  PUNCH_SUCCESS: 'PUNCH_SUCCESS',
  OUTSIDE_GEOFENCE: 'OUTSIDE_GEOFENCE',
  PENDING_MANAGER_APPROVAL: 'PENDING_MANAGER_APPROVAL',
  ACCURACY_EXCEEDED: 'ACCURACY_EXCEEDED',
  IMPOSSIBLE_TRAVEL: 'IMPOSSIBLE_TRAVEL',
  SELFIE_REQUIRED: 'SELFIE_REQUIRED',
  MOCK_LOCATION_DETECTED: 'MOCK_LOCATION_DETECTED',
  GEOFENCE_NOT_ASSIGNED: 'GEOFENCE_NOT_ASSIGNED',
  POLICY_NOT_FOUND: 'POLICY_NOT_FOUND',
  SOURCE_NOT_ALLOWED: 'SOURCE_NOT_ALLOWED',
  SHIFT_NOT_FOUND: 'SHIFT_NOT_FOUND',
  DEVICE_NOT_REGISTERED: 'DEVICE_NOT_REGISTERED',
  QR_VERIFIED: 'QR_VERIFIED',
  WIFI_VERIFIED: 'WIFI_VERIFIED',
  PERIOD_LOCKED: 'PERIOD_LOCKED',
} as const;

export type PunchReasonCode = (typeof PUNCH_REASON_CODES)[keyof typeof PUNCH_REASON_CODES];

export const PUNCH_REASON_MESSAGES: Record<PunchReasonCode, string> = {
  PUNCH_SUCCESS: 'Punch recorded successfully.',
  OUTSIDE_GEOFENCE: 'You are outside the authorized geofence boundary.',
  PENDING_MANAGER_APPROVAL: 'Punch recorded outside geofence. Sent to your manager for approval.',
  ACCURACY_EXCEEDED: 'GPS accuracy is insufficient. Please move to an open area and retry.',
  IMPOSSIBLE_TRAVEL: 'Consecutive punches detected from impossible distance/velocity.',
  SELFIE_REQUIRED: 'Selfie verification required by company attendance policy.',
  MOCK_LOCATION_DETECTED: 'Mock/spoofed GPS location detected. Punch rejected.',
  GEOFENCE_NOT_ASSIGNED: 'No work location assigned for attendance tracking.',
  POLICY_NOT_FOUND: 'No active attendance policy found.',
  SOURCE_NOT_ALLOWED: 'Punch source is not permitted under attendance policy.',
  SHIFT_NOT_FOUND: 'No active shift assigned for this work date.',
  DEVICE_NOT_REGISTERED: 'Mobile device is not registered or approved for attendance.',
  QR_VERIFIED: 'Punch verified via rotating QR code.',
  WIFI_VERIFIED: 'Punch verified via office Wi-Fi network.',
  PERIOD_LOCKED: 'Attendance period is locked for payroll processing.',
};

export const recordPunchSchema = z.object({
  employeeId: z.string().uuid().optional(),
  punchType: z.enum(['in', 'out']),
  punchTime: z.union([z.string().datetime(), z.date()]).transform((val) => new Date(val)),
  source: z.enum(['mobile', 'web', 'biometric', 'qr']).default('web'),
  idempotencyKey: z.string().min(8).max(128).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracyMeters: z.number().min(0).max(10000).optional(),
  selfieFileId: z.string().uuid().optional(),
  deviceId: z.string().max(128).optional(),
  deviceModel: z.string().max(128).optional(),
  isMockLocation: z.boolean().default(false),
  wifiBssid: z.string().optional(),
  qrPayload: z.string().optional(),
  notes: z.string().max(500).optional(),
});

export type RecordPunchInput = z.infer<typeof recordPunchSchema>;
