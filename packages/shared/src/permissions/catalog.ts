/**
 * Phase 1 Permission Catalog
 * Strictly formatted as `module.resource.action` per docs/PHASE1_SPEC.md Section 3.
 */
export const PERMISSIONS = {
  // Auth & User Management
  AUTH_USER_READ: 'auth.user.read',
  AUTH_USER_CREATE: 'auth.user.create',
  AUTH_USER_UPDATE: 'auth.user.update',
  AUTH_USER_DEACTIVATE: 'auth.user.deactivate',
  AUTH_USER_RESET_MFA: 'auth.user.reset_mfa',
  AUTH_SESSION_READ: 'auth.session.read',
  AUTH_SESSION_REVOKE: 'auth.session.revoke',
  AUTH_ROLE_READ: 'auth.role.read',
  AUTH_ROLE_CREATE: 'auth.role.create',
  AUTH_ROLE_UPDATE: 'auth.role.update',
  AUTH_ROLE_DELETE: 'auth.role.delete',
  AUTH_ROLE_ASSIGN: 'auth.role.assign',

  // Organization Structure
  ORG_COMPANY_READ: 'org.company.read',
  ORG_COMPANY_UPDATE: 'org.company.update',
  ORG_DEPARTMENT_READ: 'org.department.read',
  ORG_DEPARTMENT_MANAGE: 'org.department.manage',
  ORG_DESIGNATION_READ: 'org.designation.read',
  ORG_DESIGNATION_MANAGE: 'org.designation.manage',
  ORG_GRADE_READ: 'org.grade.read',
  ORG_GRADE_MANAGE: 'org.grade.manage',
  ORG_COSTCENTER_READ: 'org.costcenter.read',
  ORG_COSTCENTER_MANAGE: 'org.costcenter.manage',
  ORG_LOCATION_READ: 'org.location.read',
  ORG_LOCATION_MANAGE: 'org.location.manage',
  ORG_CUSTOMFIELD_READ: 'org.customfield.read',
  ORG_CUSTOMFIELD_MANAGE: 'org.customfield.manage',
  ORG_CHART_READ: 'org.chart.read',

  // Employee Master & Profile
  EMPLOYEE_PROFILE_READ: 'employee.profile.read',
  EMPLOYEE_PROFILE_CREATE: 'employee.profile.create',
  EMPLOYEE_PROFILE_UPDATE: 'employee.profile.update',
  EMPLOYEE_PROFILE_DELETE: 'employee.profile.delete',
  EMPLOYEE_PROFILE_EXPORT: 'employee.profile.export',
  EMPLOYEE_PROFILE_IMPORT: 'employee.profile.import',
  EMPLOYEE_PROFILE_VIEW_SENSITIVE: 'employee.profile.view_sensitive',
  EMPLOYEE_HISTORY_READ: 'employee.history.read',
  EMPLOYEE_DOCUMENT_READ: 'employee.document.read',
  EMPLOYEE_DOCUMENT_UPLOAD: 'employee.document.upload',
  EMPLOYEE_DOCUMENT_VERIFY: 'employee.document.verify',
  EMPLOYEE_DOCUMENT_DELETE: 'employee.document.delete',
  EMPLOYEE_CHANGEREQUEST_CREATE: 'employee.changerequest.create',
  EMPLOYEE_CHANGEREQUEST_APPROVE: 'employee.changerequest.approve',

  // Audit Logs
  AUDIT_LOG_READ: 'audit.log.read',
  AUDIT_LOG_READ_OWN: 'audit.log.read_own',

  // Notifications
  NOTIFICATION_PREFERENCE_MANAGE: 'notification.preference.manage',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS = Object.values(PERMISSIONS);
