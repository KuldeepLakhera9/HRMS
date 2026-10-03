import { pgTable, text, boolean, integer, jsonb, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { baseTenantColumns } from '../columns.js';

export const customFieldDefinitions = pgTable(
  'custom_field_definitions',
  {
    ...baseTenantColumns,
    entity: text('entity', {
      enum: ['employee', 'department', 'location'],
    }).notNull(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    type: text('type', {
      enum: ['text', 'number', 'date', 'select', 'boolean', 'json'],
    }).notNull(),
    required: boolean('required').default(false).notNull(),
    options: jsonb('options').$type<string[] | { label: string; value: string }[]>().default([]),
    section: text('section').default('general').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    viewPermission: text('view_permission'),
    editPermission: text('edit_permission'),
    validation: jsonb('validation').$type<Record<string, unknown>>().default({}),
  },
  table => [
    uniqueIndex('idx_custom_field_definitions_company_id_id').on(table.companyId, table.id),
    uniqueIndex('idx_custom_field_definitions_company_entity_key').on(
      table.companyId,
      table.entity,
      table.key,
    ),
    index('idx_custom_field_definitions_lookup').on(table.companyId, table.entity, table.sortOrder),
  ],
);

export type CustomFieldDefinition = typeof customFieldDefinitions.$inferSelect;
export type NewCustomFieldDefinition = typeof customFieldDefinitions.$inferInsert;
