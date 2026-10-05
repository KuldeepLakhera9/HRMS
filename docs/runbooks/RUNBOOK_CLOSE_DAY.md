# Runbook: Daily Attendance Day-Close Job

## 1. Overview
The **Day-Close Job** (`attendance.close_day`) is an automated daily reconciliation worker managed by BullMQ. It processes all employees for a given company and date, reconciles open punches against assigned shifts, applies grace periods, triggers synthetic auto-outs for missing checkout punches, computes work/break minutes, tags exceptions, and marks the day record as finalized.

- **Schedule**: Every day at `03:30 AM UTC` (post-shift window closure for night shifts).
- **Queue**: `attendance-day-close` (Redis / BullMQ).
- **Concurrency**: 5 worker threads, batch size 250 employees.
- **Idempotency**: Strictly idempotent; recalculating an existing day record compares current row version and updates only if changed.

---

## 2. Standard Automation & Monitoring
- **Prometheus Metrics**:
  - `hrms_day_close_duration_seconds`: Total runtime of batch closure.
  - `hrms_day_close_processed_total`: Count of processed employee days.
  - `hrms_day_close_errors_total`: Count of unhandled exceptions during closure.
- **Alert Thresholds**:
  - `DayCloseJobFailed`: Triggered if BullMQ job status is `failed` or execution time $> 15\text{ minutes}$.
  - `UnreconciledPunchesWarning`: Triggered if $> 5\%$ of punches remain unassigned to a day record.

---

## 3. Manual Execution / Re-Run Procedure

If the automated run was skipped due to infrastructure maintenance or Redis downtime:

### Option A: Via Management CLI
```bash
# Execute day-close for all active tenants for a specific date
pnpm --filter @hrms/worker run exec:close-day --date=2026-10-04

# Execute for a single tenant
pnpm --filter @hrms/worker run exec:close-day --companyId=01912345-6789-7abc-def0-123456789abc --date=2026-10-04
```

### Option B: Via HTTP API (Requires `attendance:manage` permission)
```bash
curl -X POST https://hrms.internal/api/v1/attendance/day-close/trigger \
  -H "Authorization: Bearer $SUPERADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"date": "2026-10-04", "forceRecompute": true}'
```

---

## 4. Troubleshooting & Remediation

### Scenario 1: Worker OOM or High Latency on 5,000+ Employees
1. Check BullMQ queue lag:
   ```bash
   redis-cli LLEN "bull:attendance-day-close:wait"
   ```
2. If memory spikes, reduce batch size in environment config:
   ```env
   ATTENDANCE_DAY_CLOSE_CHUNK_SIZE=100
   ```
3. Restart worker pool:
   ```bash
   docker restart hrms-worker
   ```

### Scenario 2: Locked Period Prevents Closure
If the day being recomputed falls into a locked payroll period:
1. The service will skip recomputation and raise a `PeriodLockedError`.
2. Follow `docs/runbooks/RUNBOOK_PERIOD_UNLOCK.md` to temporarily unlock the period with dual approval.
