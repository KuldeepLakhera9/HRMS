import type { TenantContext } from '@hrms/db';

export interface RequestContext extends TenantContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
  isAuthenticated: boolean;
}

export function createAnonymousContext(requestId: string): RequestContext {
  return {
    companyId: '00000000-0000-0000-0000-000000000000',
    requestId,
    isAuthenticated: false,
    roles: [],
    permissions: [],
  };
}
