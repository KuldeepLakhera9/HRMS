# Runbook: Employee Mobile Device Reset & Re-Registration

## 1. Overview
Employees authenticate their mobile attendance via device-bound hardware telemetry (Android Play Integrity hardware key or iOS DeviceCheck). To prevent buddy punching and credential sharing, an employee is allowed only **one active registered mobile device** at any time.

When an employee loses, breaks, or upgrades their smartphone, their existing device registration must be revoked before a new handset can be bound.

---

## 2. Standard Reset Workflow (Employee Self-Service with HR Approval)
1. Employee downloads the HRMS mobile app on their new handset.
2. Employee logs in with credentials and completes MFA.
3. The app detects a device mismatch and presents the **Device Registration Request** screen.
4. The employee submits a re-registration request with a mandatory reason (e.g., "Upgraded phone to iPhone 15").
5. The request triggers a high-priority approval task routed to the employee's Reporting Manager or HR Administrator.
6. Once approved, the system automatically marks the previous device as `revoked` and registers the new device as `active`.

---

## 3. Emergency Administrator Reset (IT Helpdesk Procedure)

If an employee's device is stolen or lost, IT Support can immediately revoke device access via Admin Console or API to prevent unauthorized access.

### Revoke Device via Management API
```bash
# Revoke existing device for employee
curl -X POST https://hrms.internal/api/v1/attendance/devices/revoke \
  -H "Authorization: Bearer $HR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "employeeId": "01912345-6789-7abc-def0-123456789abc",
    "reason": "Reported lost device by employee ticket #HD-9081"
  }'
```

### Direct Database Intervention (Break-Glass Only)
In emergency situations where the management API is unreachable:
```sql
-- Connect as hrms_owner or app role with tenant context
BEGIN;
SELECT set_config('app.company_id', '<company_id>', true);

-- Mark existing device as revoked
UPDATE employee_devices
SET
  status = 'revoked',
  revoked_at = NOW(),
  revoked_by = '<admin_user_id>',
  revocation_reason = 'Break-glass emergency reset'
WHERE employee_id = '<employee_id>' AND status = 'active';

COMMIT;
```

---

## 4. Verification & Audit Trail
1. Verify device status:
   ```sql
   SELECT id, hardware_id, device_model, platform, status, last_seen_at
   FROM employee_devices
   WHERE employee_id = '<employee_id>';
   ```
2. Verify an immutable audit log entry was created:
   ```sql
   SELECT id, action, entity_type, entity_id, actor_id, created_at, details
   FROM audit_logs
   WHERE entity_id = '<employee_id>' AND action = 'device.revoked'
   ORDER BY created_at DESC LIMIT 1;
   ```
3. Ask the employee to open HRMS Mobile on the new device; the registration wizard will now allow binding without conflict.
