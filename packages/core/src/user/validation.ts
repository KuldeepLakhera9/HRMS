import { z } from 'zod';

export const ListUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['invited', 'active', 'locked', 'disabled']).optional(),
  roleId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
});

export const CreateUserSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase().trim(),
  password: z.string().min(8, 'Password must be at least 8 characters').optional(),
  employeeId: z.string().uuid('Invalid employee ID').optional().nullable(),
  roleIds: z.array(z.string().uuid('Invalid role ID')).default([]),
  status: z.enum(['invited', 'active']).default('active'),
});

export const UpdateUserSchema = z.object({
  employeeId: z.string().uuid('Invalid employee ID').optional().nullable(),
  status: z.enum(['invited', 'active', 'locked', 'disabled']).optional(),
});

export type ListUsersQuery = {
  page?: number | undefined;
  limit?: number | undefined;
  status?: 'invited' | 'active' | 'locked' | 'disabled' | undefined;
  roleId?: string | undefined;
  search?: string | undefined;
};

export type CreateUserInput = {
  email: string;
  password?: string | undefined;
  employeeId?: string | null | undefined;
  roleIds?: string[] | undefined;
  status?: 'invited' | 'active' | undefined;
};

export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
