# ADR 0015: Attendance Period Lock Check Skip Guard

## Status
Accepted

## Context
When transitioning a payroll run from `draft` to `inputs_ready`, the payroll engine verifies that the corresponding attendance period has been locked (`attendance_periods.status = 'locked'`) and that `attendance_period_summary` records exist for all eligible employees.
During testing and automated QA in non-production environments, tests frequently exercise payroll calculations without running the entire multi-step attendance locking workflow. However, bypassing the attendance lock in production would permit running payroll on unapproved, shifting attendance data.

## Decision
1. **Environment-Guarded Flag (`skipAttendanceLockCheck`)**:
   - `assertInputsReadyPreconditions` accepts `options.skipAttendanceLockCheck`.
   - The flag is strictly ignored if `process.env.NODE_ENV === 'production'`. In production environments, an unlocked attendance period or missing attendance summaries will unconditionally raise `ValidationError`.
   - In non-production environments (`test`, `development`), setting `skipAttendanceLockCheck: true` allows developers and integration tests to verify downstream payroll calculations and state transitions independently.

## Consequences
- Zero risk of running payroll against unlocked attendance in production.
- Flexible, isolated integration and unit testing for payroll domain modules.
