import { z } from 'zod';
import { PERMISSION_SCOPES, ALL_PERMISSIONS, type PermissionScope } from '@hrms/shared';

export const RolePermissionEntrySchema = z.object({
  permissionKey: z.string().refine(val => (ALL_PERMISSIONS as readonly string[]).includes(val), {
    message: 'Invalid permission key',
  }),
  scope: z.enum(PERMISSION_SCOPES),
});

export const CreateRoleSchema = z.object({
  name: z
    .string()
    .min(2, 'Role name must be at least 2 characters')
    .max(50, 'Role name must be at most 50 characters')
    .trim(),
  description: z.string().max(255).optional(),
  requiresMfa: z.boolean().default(false),
  permissions: z.array(RolePermissionEntrySchema).default([]),
});

export const UpdateRoleSchema = z.object({
  name: z
    .string()
    .min(2, 'Role name must be at least 2 characters')
    .max(50, 'Role name must be at most 50 characters')
    .trim()
    .optional(),
  description: z.string().max(255).optional().nullable(),
  requiresMfa: z.boolean().optional(),
  permissions: z.array(RolePermissionEntrySchema).optional(),
});

export const AssignUserRolesSchema = z.object({
  roleIds: z.array(z.string().uuid('Invalid role ID')),
});

export type CreateRoleInput = {
  name: string;
  description?: string | undefined;
  requiresMfa?: boolean | undefined;
  permissions?: { permissionKey: string; scope: PermissionScope }[] | undefined;
};
export type UpdateRoleInput = z.infer<typeof UpdateRoleSchema>;
export type AssignUserRolesInput = z.infer<typeof AssignUserRolesSchema>;
