# Runbook: Locked Attendance & Payroll Period Unlock Procedure

## 1. Overview
To ensure compliance with statutory payroll audits and prevent retroactive tampering with finalized wage calculations, attendance periods are **locked** following monthly payroll sign-off (via `attendance_locks` table).

Once a period is locked:
- Punches cannot be modified or added for dates within the locked window.
- Regularization requests for locked dates are automatically rejected.
- Recalculation and day-close jobs bypass locked periods.

This runbook defines the exceptional, break-glass procedure for temporarily unlocking a period when retroactive corrections (e.g., labor dispute settlement or court order) are legally mandated.

---

## 2. Policy & Authorization Requirements
Unlocking an attendance period requires **Dual-Control Authorization**:
1. Written approval from the **Head of Human Resources / HR VP**.
2. Written sign-off from the **Chief Financial Officer (CFO)** or Controller.
3. A formal Ticket Reference (e.g. `PAYROLL-AUDIT-9921`).

Any unlock action is recorded in the immutable audit log and automatically generates an alert to the internal audit committee.

---

## 3. Unlock Procedure

### Step 1: Submit Unlock Request via API
```bash
curl -X POST https://hrms.internal/api/v1/attendance/locks/unlock \
  -H "Authorization: Bearer $HR_VP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "companyId": "01912345-6789-7abc-def0-123456789abc",
    "startDate": "2026-09-01",
    "endDate": "2026-09-30",
    "reason": "Retroactive regularization per Labor Court settlement order #LC-492/2026",
    "dualApproverEmail": "cfo@company.com",
    "unlockDurationHours": 4
  }'
```

### Step 2: CFO Dual-Authorization Confirmation
The dual approver receives a time-sensitive notification with an OTP / confirmation link to authorize the unlock window:
```bash
curl -X POST https://hrms.internal/api/v1/attendance/locks/unlock/confirm \
  -H "Authorization: Bearer $CFO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "unlockRequestId": "01923456-7890-7abc-def0-234567890def",
    "approvalCode": "OTP-883921"
  }'
```

Upon confirmation:
- The system temporarily sets `is_locked: false` on the target period in `attendance_locks`.
- An automatic expiry timer (default 4 hours) is armed in BullMQ / Redis to re-lock the period automatically.

---

## 4. Post-Correction Reconciliation & Re-Lock
1. **Apply Corrections**:
   HR submits and approves the required regularizations or exception resolutions.
2. **Recompute Affected Days**:
   Trigger recalculation for affected employees:
   ```bash
   pnpm --filter @hrms/worker run exec:recompute-day --companyId=<company_id> --startDate=2026-09-01 --endDate=2026-09-30
   ```
3. **Immediate Manual Re-Lock**:
   Do not wait for the 4-hour automatic timer to expire:
   ```bash
   curl -X POST https://hrms.internal/api/v1/attendance/locks/lock \
     -H "Authorization: Bearer $HR_VP_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "companyId": "01912345-6789-7abc-def0-123456789abc",
       "startDate": "2026-09-01",
       "endDate": "2026-09-30",
       "reason": "Corrections completed. Period re-locked."
     }'
   ```
4. **Audit Review**:
   Generate an audit diff report of all attendance records altered during the unlocked window:
   ```sql
   SELECT
     a.id, a.employee_id, a.action, a.created_at, a.actor_id, a.details
   FROM audit_logs a
   WHERE a.company_id = '<company_id>'
     AND a.created_at >= '<unlock_timestamp>'
     AND a.entity_type IN ('attendance_day', 'attendance_regularization')
   ORDER BY a.created_at ASC;
   ```
5. File the audit diff report in the compliance document repository.
