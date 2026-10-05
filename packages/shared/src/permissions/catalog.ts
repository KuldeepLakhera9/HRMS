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

  // Workflow Engine (Phase 2)
  WORKFLOW_DEFINITION_MANAGE: 'workflow.definition.manage',
  WORKFLOW_REQUEST_CREATE: 'workflow.request.create',
  WORKFLOW_REQUEST_READ: 'workflow.request.read',
  WORKFLOW_ACTION_EXECUTE: 'workflow.action.execute',
  WORKFLOW_DELEGATION_MANAGE: 'workflow.delegation.manage',

  // Attendance & Geofencing (Phase 2)
  ATTENDANCE_POLICY_READ: 'attendance.policy.read',
  ATTENDANCE_POLICY_MANAGE: 'attendance.policy.manage',
  ATTENDANCE_LOCATION_ASSIGN: 'attendance.location.assign',
  ATTENDANCE_PUNCH_CREATE: 'attendance.punch.create',
  ATTENDANCE_PUNCH_READ: 'attendance.punch.read',
  ATTENDANCE_SHIFT_READ: 'attendance.shift.read',
  ATTENDANCE_SHIFT_MANAGE: 'attendance.shift.manage',
  ATTENDANCE_ROSTER_READ: 'attendance.roster.read',
  ATTENDANCE_ROSTER_MANAGE: 'attendance.roster.manage',
  ATTENDANCE_PRESENCE_READ: 'attendance.presence.read',
  ATTENDANCE_DEVICE_MANAGE: 'attendance.device.manage',
  ATTENDANCE_LOCK_MANAGE: 'attendance.lock.manage',
  ATTENDANCE_DAY_READ: 'attendance.day.read',
  ATTENDANCE_DAY_RECALCULATE: 'attendance.day.recalculate',
  ATTENDANCE_REGULARIZATION_CREATE: 'attendance.regularization.create',
  ATTENDANCE_REGULARIZATION_READ: 'attendance.regularization.read',
  ATTENDANCE_REGULARIZATION_APPROVE: 'attendance.regularization.approve',
  ATTENDANCE_EXCEPTION_READ: 'attendance.exception.read',
  ATTENDANCE_EXCEPTION_MANAGE: 'attendance.exception.manage',
  ATTENDANCE_BIOMETRIC_MANAGE: 'attendance.biometric.manage',
  ATTENDANCE_PUNCH_VIEW_MAP: 'attendance.punch.view_map',
  ATTENDANCE_LOCATION_DATA_VIEW: 'attendance.location_data.view',

  // Leave & Holidays (Phase 3)
  LEAVE_TYPE_READ: 'leave.type.read',
  LEAVE_TYPE_MANAGE: 'leave.type.manage',
  LEAVE_POLICY_READ: 'leave.policy.read',
  LEAVE_POLICY_MANAGE: 'leave.policy.manage',
  LEAVE_BALANCE_READ: 'leave.balance.read',
  LEAVE_BALANCE_ADJUST: 'leave.balance.adjust',
  LEAVE_REQUEST_CREATE: 'leave.request.create',
  LEAVE_REQUEST_READ: 'leave.request.read',
  LEAVE_REQUEST_CANCEL: 'leave.request.cancel',
  LEAVE_CALENDAR_READ: 'leave.calendar.read',
  LEAVE_COMPOFF_CLAIM: 'leave.compoff.claim',
  LEAVE_COMPOFF_MANAGE: 'leave.compoff.manage',
  HOLIDAY_READ: 'holiday.read',
  HOLIDAY_MANAGE: 'holiday.manage',

  // Reports, Notifications & Helpdesk (Phase 3)
  REPORT_RUN: 'report.run',
  REPORT_SCHEDULE_MANAGE: 'report.schedule.manage',
  REPORT_EXPORT: 'report.export',
  ANNOUNCEMENT_READ: 'announcement.read',
  ANNOUNCEMENT_MANAGE: 'announcement.manage',
  HELPDESK_TICKET_CREATE: 'helpdesk.ticket.create',
  HELPDESK_TICKET_READ: 'helpdesk.ticket.read',
  HELPDESK_TICKET_MANAGE: 'helpdesk.ticket.manage',
  IMPORT_LEAVE_BALANCES: 'import.leave_balances',
  IMPORT_ATTENDANCE: 'import.attendance',
  FEATUREFLAG_MANAGE: 'featureflag.manage',
  FEEDBACK_CREATE: 'feedback.create',
  FEEDBACK_READ: 'feedback.read',
  PILOT_METRICS_READ: 'pilot.metrics.read',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS = Object.values(PERMISSIONS);

