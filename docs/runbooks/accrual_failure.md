# Runbook: Leave Accrual Job Failure & Recovery

## 1. Overview
The **Leave Accrual Job** (`leave.accrual`) is scheduled via BullMQ to run on the 1st of every month (or start of accrual period) at `00:30 UTC`. It iterates over active employees across all tenants, resolves their effective leave policy, calculates the monthly/annual quota allocation, writes an append-only entry to `leave_ledger`, and updates `leave_balances`.

- **Queue**: `leave-accrual` (Redis / BullMQ).
- **Concurrency**: 4 worker processes; 200 employee batches.
- **Idempotency Key**: `accrual:{companyId}:{employeeId}:{leaveTypeId}:{year}-{month}`.
- **Table Constraints**:
  - `leave_ledger` enforces append-only triggers (UPDATE/DELETE strictly prohibited).
  - Dedupe keys prevent duplicate credits for the same period.

---

## 2. Detection & Alerts
- **Prometheus Metric**: `hrms_leave_accrual_errors_total > 0`
- **Alert**: `LeaveAccrualJobFailed` or `LeaveAccrualIncomplete`
- **Symptoms**:
  - Employees report missing monthly earned leave credits on the 1st.
  - BullMQ dead-letter queue has unprocessed jobs.

---

## 3. Diagnostic Steps

### Step 1: Inspect BullMQ Queue Status
```bash
redis-cli -h $REDIS_HOST -p $REDIS_PORT
# Check waiting and failed job counts
LLEN "bull:leave-accrual:wait"
ZCARD "bull:leave-accrual:failed"
```

### Step 2: Check Worker Logs
```bash
docker logs hrms-worker --tail 100 --since 1h | grep "leave.accrual"
```

### Step 3: Run Database Integrity Check
Check how many employees have not received accrual for the target period:
```sql
SELECT 
  e.company_id,
  COUNT(e.id) AS unaccrued_employees
FROM employees e
JOIN leave_policy_assignments lpa 
  ON lpa.company_id = e.company_id AND lpa.employee_id = e.id
LEFT JOIN leave_ledger ll 
  ON ll.company_id = e.company_id 
  AND ll.employee_id = e.id 
  AND ll.dedupe_key LIKE 'accrual:%:' || TO_CHAR(CURRENT_DATE, 'YYYY-MM')
WHERE e.status = 'active'
  AND e.deleted_at IS NULL
  AND ll.id IS NULL
GROUP BY e.company_id;
```

---

## 4. Remediation Procedures

### Option A: Re-Trigger via Management CLI (Safe & Idempotent)
Because all accrual entries use deterministic dedupe keys, re-running is safe and will skip already accrued employees:
```bash
# Re-run accrual for a specific company and period
pnpm --filter @hrms/worker run exec:leave-accrual \
  --companyId="01912345-6789-7abc-def0-123456789abc" \
  --period="2026-10"

# Dry-run mode to verify calculations without writing ledger entries
pnpm --filter @hrms/worker run exec:leave-accrual \
  --companyId="01912345-6789-7abc-def0-123456789abc" \
  --period="2026-10" \
  --dryRun=true
```

### Option B: Trigger via System Route
```bash
curl -X POST https://hrms.internal/api/v1/leave/admin/accrual/run \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "period": "2026-10",
    "force": false
  }'
```

---

## 5. Post-Remediation Verification
1. Verify that `leave_balances.closing_balance` reflects the new accrual credit.
2. Verify that `leave.reconcile_balances` returns 0 mismatches:
   ```bash
   pnpm --filter @hrms/worker run exec:reconcile-leave-balances --companyId="01912345-6789-7abc-def0-123456789abc"
   ```
3. Confirm with HR administrator on the Leave Balances dashboard.
