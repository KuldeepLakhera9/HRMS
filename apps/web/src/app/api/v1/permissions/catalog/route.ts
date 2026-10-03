import { createNextRoute, RbacService } from '@hrms/core';
import { PERMISSIONS } from '@hrms/shared';

const rbacService = new RbacService();

export const GET = createNextRoute({
  permission: PERMISSIONS.AUTH_ROLE_READ,
  handler: async () => {
    const catalog = rbacService.getPermissionCatalog();
    return { data: catalog };
  },
});
