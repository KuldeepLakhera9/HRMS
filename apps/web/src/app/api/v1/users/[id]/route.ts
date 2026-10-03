import { z } from 'zod';
import { createNextRoute, UserService, UpdateUserSchema } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const userService = new UserService();

const getUserSchema = z.object({
  id: z.string().uuid('User ID must be a valid UUID.'),
});

export const GET = createNextRoute({
  permission: PERMISSIONS.AUTH_USER_READ,
  schema: getUserSchema,
  handler: async (input, ctx) => {
    const user = await userService.getUser(ctx, input.id);
    return { data: user };
  },
});

const updateUserWithIdSchema = UpdateUserSchema.extend({
  id: z.string().uuid('User ID must be a valid UUID.'),
});

export const PATCH = createNextRoute({
  permission: PERMISSIONS.AUTH_USER_UPDATE,
  schema: updateUserWithIdSchema,
  handler: async (input, ctx) => {
    const { id, ...data } = input;
    const user = await userService.updateUser(ctx, id, data);
    return { data: user };
  },
});
