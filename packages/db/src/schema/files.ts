import { pgTable, uuid, text, bigint, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { baseTenantColumns } from '../columns.js';

export const files = pgTable(
  'files',
  {
    ...baseTenantColumns,
    bucket: text('bucket').notNull(),
    objectKey: text('object_key').notNull(),
    originalName: text('original_name').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256'),
    status: text('status', { enum: ['pending', 'clean', 'rejected'] })
      .default('pending')
      .notNull(),
    ownerType: text('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),
    uploadedBy: uuid('uploaded_by').notNull(),
  },
  table => [
    uniqueIndex('idx_files_bucket_object').on(table.bucket, table.objectKey),
    index('idx_files_owner').on(table.companyId, table.ownerType, table.ownerId),
  ],
);

export type FileRecord = typeof files.$inferSelect;
export type NewFileRecord = typeof files.$inferInsert;
