import type { TenantContext } from '@hrms/db';

export interface RequestContext extends TenantContext {
  requestId: string;
  sessionId?: string | undefined;
  stepUpUntil?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
  isAuthenticated: boolean;
}

export function createAnonymousContext(
  requestId: string,
  ip?: string | undefined,
  userAgent?: string | undefined,
): RequestContext {
  return {
    companyId: '00000000-0000-0000-0000-000000000000',
    requestId,
    ip,
    userAgent,
    isAuthenticated: false,
    roles: [],
    permissions: [],
  };
}
