# Operational Runbook: Payroll Run Stuck or Crashed

**Document ID**: `RB-PAY-01`  
**Target Roles**: SRE, DevOps, Payroll Operations Lead  
**Classification**: Operational Recovery Procedure  

---

## 1. Overview & Symptom Diagnosis
A payroll run can become stuck in an active processing state (`calculating` or `locking`) due to worker crash, container OOM, or database connectivity drops.

### Diagnostic Query
```sql
SELECT id, period_id, status, run_type, updated_at,
       NOW() - updated_at AS duration_in_state
FROM payroll_runs
WHERE status IN ('calculating', 'locking')
  AND updated_at < NOW() - INTERVAL '10 minutes';
```

---

## 2. Recovery Procedures

### Scenario A: Run Stuck in `calculating` State
1. **Verify Worker Status**:
   - Check BullMQ queue `payroll-calc-queue` in worker dashboard or Redis.
   - Inspect container logs: `docker logs hrms-worker --tail 200`.
2. **Safe Transition to `draft`**:
   Execute the transition via API or CLI runner:
   ```bash
   pnpm exec tsx scripts/payroll_ops.ts transition-run --run-id <RUN_ID> --to-status draft --reason "Worker crash detected during batch calculation"
   ```
   *Underlying Engine*: `executeRunTransition(ctx, tx, runId, 'draft', { reason: '...' })`.
3. **Verify Staged Records**:
   Ensure no orphaned calculations remain:
   ```sql
   DELETE FROM payroll_staging_results WHERE run_id = '<RUN_ID>';
   ```
4. **Trigger Re-Calculation**:
   Re-trigger the calculation through the Payroll Console.

### Scenario B: Run Stuck in `locking` State
1. **Analyze Lock Worker Failure**:
   Check if database timeout occurred during control total verification or MinIO upload.
2. **Rollback to `review`**:
   The state machine explicitly permits the `locking -> review` rollback transition:
   ```bash
   pnpm exec tsx scripts/payroll_ops.ts transition-run --run-id <RUN_ID> --to-status review --reason "Materialization failure during lock; rolling back to review"
   ```
3. **Verify Clean Rollback**:
   Confirm no partial payslip rows remain for the run:
   ```sql
   SELECT count(*) FROM payslips WHERE run_id = '<RUN_ID>';
   ```
   If partial rows exist before re-locking, clean them via the lifecycle manager rollback.

---

## 3. Post-Recovery Verification
- [ ] Payroll run status is strictly `draft` or `review`.
- [ ] `payroll_run_events` has logged the transition event with non-empty justification.
- [ ] System alerts in Sentry / PagerDuty resolved.
