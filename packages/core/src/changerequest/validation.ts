import { z } from 'zod';

export const createChangeRequestSchema = z.object({
  phone: z.string().optional(),
  emailPersonal: z.string().email().optional(),
  maritalStatus: z.string().optional(),
  addresses: z.record(z.unknown()).optional(),
  emergencyContacts: z.array(z.record(z.unknown())).optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field change must be provided',
});

export const decideChangeRequestSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().max(500).optional(),
});

export type CreateChangeRequestInput = z.infer<typeof createChangeRequestSchema>;
export type DecideChangeRequestInput = z.infer<typeof decideChangeRequestSchema>;
