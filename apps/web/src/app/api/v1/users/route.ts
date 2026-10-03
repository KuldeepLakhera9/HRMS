import { createNextRoute, UserService, ListUsersQuerySchema, CreateUserSchema } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const userService = new UserService();

export const GET = createNextRoute({
  permission: PERMISSIONS.AUTH_USER_READ,
  schema: ListUsersQuerySchema,
  handler: async (query, ctx) => {
    const result = await userService.listUsers(ctx, query);
    return { data: result.users, total: result.total, page: result.page, limit: result.limit };
  },
});

export const POST = createNextRoute({
  permission: PERMISSIONS.AUTH_USER_CREATE,
  schema: CreateUserSchema,
  handler: async (input, ctx) => {
    const result = await userService.createUser(ctx, input);
    return { data: result.user, temporaryPassword: result.temporaryPassword };
  },
});
