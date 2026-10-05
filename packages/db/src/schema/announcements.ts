import { pgTable, uuid, text, boolean, timestamp, uniqueIndex, index, foreignKey } from 'drizzle-orm/pg-core';
import { baseTenantColumns } from '../columns.js';
import { departments, workLocations } from './org.js';

export const announcements = pgTable(
  'announcements',
  {
    ...baseTenantColumns,
    title: text('title').notNull(),
    contentMd: text('content_md').notNull(),
    audienceType: text('audience_type', { enum: ['all', 'department', 'location'] }).default('all').notNull(),
    targetDeptId: uuid('target_dept_id'),
    targetLocId: uuid('target_loc_id'),
    isPinned: boolean('is_pinned').default(false).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
  },
  table => [
    uniqueIndex('idx_announcements_company_id').on(table.companyId, table.id),
    index('idx_announcements_published').on(table.companyId, table.publishedAt),
    index('idx_announcements_pinned').on(table.companyId, table.isPinned),
    foreignKey({
      columns: [table.companyId, table.targetDeptId],
      foreignColumns: [departments.companyId, departments.id],
      name: 'fk_announcements_target_dept',
    }).onDelete('set null'),
    foreignKey({
      columns: [table.companyId, table.targetLocId],
      foreignColumns: [workLocations.companyId, workLocations.id],
      name: 'fk_announcements_target_loc',
    }).onDelete('set null'),
  ],
);

export const announcementReads = pgTable(
  'announcement_reads',
  {
    ...baseTenantColumns,
    announcementId: uuid('announcement_id').notNull(),
    userId: uuid('user_id').notNull(),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  table => [
    uniqueIndex('idx_announcement_reads_company_id').on(table.companyId, table.id),
    uniqueIndex('idx_announcement_reads_user').on(table.companyId, table.announcementId, table.userId),
    index('idx_announcement_reads_lookup').on(table.companyId, table.userId, table.announcementId),
  ],
);

export type Announcement = typeof announcements.$inferSelect;
export type NewAnnouncement = typeof announcements.$inferInsert;
export type AnnouncementRead = typeof announcementReads.$inferSelect;
export type NewAnnouncementRead = typeof announcementReads.$inferInsert;
