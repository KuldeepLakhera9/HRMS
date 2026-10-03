import { pgTable, uuid, text, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { baseTenantColumns } from '../columns.js';

export const notifications = pgTable(
  'notifications',
  {
    ...baseTenantColumns,
    userId: uuid('user_id').notNull(),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    link: text('link'),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
  },
  table => [
    uniqueIndex('idx_notifications_company_id_id').on(table.companyId, table.id),
    index('idx_notifications_user_created').on(table.companyId, table.userId, table.createdAt),
    index('idx_notifications_user_unread').on(table.companyId, table.userId),
  ],
);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    ...baseTenantColumns,
    userId: uuid('user_id').notNull(),
    channels: jsonb('channels').$type<{ in_app?: boolean; email?: boolean }>().default({ in_app: true, email: true }).notNull(),
  },
  table => [
    uniqueIndex('idx_notification_preferences_company_id_id').on(table.companyId, table.id),
    uniqueIndex('idx_notification_preferences_user').on(table.companyId, table.userId),
  ],
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreference = typeof notificationPreferences.$inferInsert;
