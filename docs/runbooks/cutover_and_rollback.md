# Operational Runbook: Cutover, Parallel Graduation & Rollback

**Document ID**: `RB-PAY-08`  
**Target Roles**: Program Director, Head of Engineering, Finance Controller  
**Classification**: Go-Live Governance & Contingency Protocol  

---

## 1. Cutover Prerequisites & Graduation Gate
Graduation from parallel runs to primary production live payroll requires meeting all Gate G4 criteria:

1. **Parallel Run Completion**:
   - **Cycle 1**: Exploratory parallel cycle; variances categorized.
   - **Cycle 2**: Triage cycle; edge cases identified and resolved; dual CA & Finance sign-off.
   - **Cycle 3**: Zero unexplained variance (100% component match against legacy payroll within ₹0.50 tolerance); dual CA & Finance sign-off.
2. **CA Golden Cases**: 100% pass across all 52 CA golden cases covering statutory, rounding, and tax rules.
3. **Database & Infrastructure**:
   - Master-replica PostgreSQL replication healthy.
   - Disaster Recovery backup verified via SHA-256 integrity hash test (`payroll-concurrency-recovery.test.ts`).
   - PgBouncer transaction-mode connection pooler configured.

---

## 2. Cutover Execution Day Playbook (T-0)

| Time | Action | Owner | Verification |
| :--- | :--- | :--- | :--- |
| **T-4h** | Lock attendance cutoff for target payroll month | HR Ops | `attendance_periods.status = 'locked'` |
| **T-3h** | Verify all pending inputs and loans approved | Payroll Lead | 0 pending inputs |
| **T-2h** | Create Regular Payroll Run | Maker | Run status `draft` -> `inputs_ready` |
| **T-1h** | Execute Batch Calculation (5,000 employees) | System Worker | Runtime $< 5\text{ s}$; 0 errors |
| **T-45m**| Review Console inspection & variance checks | Finance Checker| Control totals match staged totals |
| **T-30m**| Dual Authorization & Run Lock | Checker + Locker | `run_hash` generated; status `locked` |
| **T-15m**| Generate Bank Advice File & Dual Approval | Treasury Lead | Encrypted file created; totals verified |
| **T-0**  | Publish Payslips & Authorize Bank File Release| Head of Finance | Payslips accessible on Web & Mobile |

---

## 3. Rollback Contingency Protocol
If a catastrophic, unrecoverable defect is discovered post-lock but PRIOR to bank disbursement:

1. **Immediate Execution Freeze**:
   - Notify Treasury team to halt bank advice upload.
2. **Execute Controlled Unlock**:
   - Follow `RB-PAY-02` (Unlock Procedure) with Step-Up auth and dual approvers.
   - The engine automatically rolls back `payroll_ytd`, resets input consumption, and voids pre-generated payslips.
3. **Fallback to Legacy System (Emergency Only)**:
   - If rollback cannot be resolved within 4 hours of disbursement deadline, fallback bank file is sourced from the parallel legacy system run.
   - All actions documented in incident RCA for post-mortem review.
