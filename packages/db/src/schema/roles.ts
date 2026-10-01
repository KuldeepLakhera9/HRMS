import { pgTable, uuid, text, boolean, integer, uniqueIndex } from 'drizzle-orm/pg-core';
import { baseTenantColumns } from '../columns.js';

export const roles = pgTable(
  'roles',
  {
    ...baseTenantColumns,
    name: text('name').notNull(),
    description: text('description'),
    isSystem: boolean('is_system').default(false).notNull(),
    requiresMfa: boolean('requires_mfa').default(false).notNull(),
    version: integer('version').default(1).notNull(),
  },
  table => [
    uniqueIndex('idx_roles_company_name').on(table.companyId, table.name),
  ],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    ...baseTenantColumns,
    roleId: uuid('role_id').notNull(),
    permissionKey: text('permission_key').notNull(),
    scope: text('scope', { enum: ['self', 'team', 'department', 'location', 'company'] })
      .default('company')
      .notNull(),
  },
  table => [
    uniqueIndex('idx_role_permissions_role_key').on(table.companyId, table.roleId, table.permissionKey),
  ],
);

export const userRoles = pgTable(
  'user_roles',
  {
    ...baseTenantColumns,
    userId: uuid('user_id').notNull(),
    roleId: uuid('role_id').notNull(),
  },
  table => [
    uniqueIndex('idx_user_roles_unique').on(table.companyId, table.userId, table.roleId),
  ],
);

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
export type RolePermission = typeof rolePermissions.$inferSelect;
export type NewRolePermission = typeof rolePermissions.$inferInsert;
export type UserRole = typeof userRoles.$inferSelect;
export type NewUserRole = typeof userRoles.$inferInsert;
