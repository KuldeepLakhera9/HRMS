# Runbook: Leave Ledger & Balance Discrepancy Reconciliation

## 1. Overview
In OrgHub HRMS, **tenant leave accounting is double-entry / ledger-backed**:
- `leave_ledger` is an immutable, append-only journal of all credits, debits, adjustments, and reversions.
- `leave_balances` is the materialized current balance snapshot used for high-speed balance lookups and concurrency row-locking (`SELECT FOR UPDATE`).
- At all times: `leave_balances.closing_balance == SUM(leave_ledger.amount)`.
- Triggers on `leave_ledger` strictly reject `UPDATE` and `DELETE` queries.

A discrepancy between the ledger sum and the cached balance indicates an interrupted transaction, concurrent race condition, or anomalous direct modification.

---

## 2. Detection & Alerts
- **Reconciliation Job**: Runs weekly or on demand via `leave.reconcile_balances`.
- **Prometheus Metric**: `hrms_leave_balance_mismatches_total > 0`
- **Alert**: `LeaveBalanceMismatchDetected`
- **User Symptom**: Employee reports that applied leaves do not match their displayed balance, or leave preview warns of balance corruption.

---

## 3. Diagnostic Query

Execute the following diagnostic query (safe, read-only) to detect any mismatched balances:

```sql
SELECT 
  lb.company_id,
  lb.employee_id,
  e.emp_no,
  u.first_name || ' ' || u.last_name AS employee_name,
  lb.leave_type_id,
  lt.name AS leave_type_name,
  lb.closing_balance AS cached_balance,
  COALESCE(SUM(ll.amount), 0) AS calculated_ledger_balance,
  (lb.closing_balance - COALESCE(SUM(ll.amount), 0)) AS variance
FROM leave_balances lb
JOIN employees e 
  ON e.company_id = lb.company_id AND e.id = lb.employee_id
JOIN users u 
  ON u.company_id = lb.company_id AND u.id = e.user_id
JOIN leave_types lt 
  ON lt.company_id = lb.company_id AND lt.id = lb.leave_type_id
LEFT JOIN leave_ledger ll 
  ON ll.company_id = lb.company_id 
  AND ll.employee_id = lb.employee_id 
  AND ll.leave_type_id = lb.leave_type_id
GROUP BY lb.company_id, lb.employee_id, e.emp_no, u.first_name, u.last_name, lb.leave_type_id, lt.name, lb.closing_balance
HAVING lb.closing_balance != COALESCE(SUM(ll.amount), 0);
```

---

## 4. Remediation Procedures

### Procedure 1: Automated Reconciliation via Worker Job
The automated reconciliation worker locks the specific `leave_balances` row and updates `closing_balance` to match the true ledger sum:

```bash
# Run reconciliation for a specific tenant
pnpm --filter @hrms/worker run exec:reconcile-leave-balances \
  --companyId="01912345-6789-7abc-def0-123456789abc" \
  --fix=true
```

### Procedure 2: Correcting a Business Discrepancy via Admin Adjustment
If the ledger itself is missing a transaction (e.g., manual compensatory credit promised to the employee):
1. **Never edit the database directly**.
2. Call the manual balance adjustment API or use the Admin Web UI:
   ```bash
   curl -X POST https://hrms.internal/api/v1/leave/admin/adjust \
     -H "Authorization: Bearer $HR_ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "employeeId": "01912345-6789-7abc-def0-123456789abc",
       "leaveTypeId": "type-paid-leave-001",
       "amount": 1.5,
       "reason": "Approved comp-off credit per ticket HD-104",
       "referenceId": "HD-104"
     }'
   ```
3. This writes an append-only entry of type `'adjustment'` to `leave_ledger` and atomically increments `leave_balances`.

---

## 5. Post-Remediation Verification
1. Re-run the diagnostic query above; verify that the output is empty (`0 rows`).
2. Verify that the employee can view their updated balance on `/leave`.
3. Check the audit log for entry `leave.balance_reconciled`.
