import { z } from 'zod';

export const updateNotificationPreferencesSchema = z.object({
  channels: z.object({
    in_app: z.boolean().default(true),
    email: z.boolean().default(true),
  }),
});

export const queryNotificationsSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type UpdateNotificationPreferencesInput = z.infer<typeof updateNotificationPreferencesSchema>;
export type QueryNotificationsInput = z.infer<typeof queryNotificationsSchema>;
