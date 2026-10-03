'use client';

import React from 'react';

export interface CanProps {
  permission: string;
  permissions?: string[] | Record<string, string> | undefined;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Declarative client-side authorization gate.
 * NOTE: UI element hiding is for UX convenience only; security is always enforced in the backend.
 */
export function Can({ permission, permissions, children, fallback = null }: CanProps) {
  if (!permissions) {
    return <>{children}</>;
  }

  let hasPermission = false;

  if (Array.isArray(permissions)) {
    hasPermission = permissions.includes(permission);
  } else if (typeof permissions === 'object') {
    hasPermission = permission in permissions;
  }

  if (hasPermission) {
    return <>{children}</>;
  }

  return <>{fallback}</>;
}
