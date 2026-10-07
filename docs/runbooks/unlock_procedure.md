# Operational Runbook: Payroll Run Unlock Procedure

**Document ID**: `RB-PAY-02`  
**Target Roles**: Head of Finance, Senior HR Operations, Compliance Auditor  
**Classification**: High-Risk Operational Procedure  

---

## 1. Policy & Authorization Requirements
Unlocking a locked payroll run is an exceptional operational event. The system enforces cryptographic, segregation-of-duties, and dual-authorization controls:

1. **Permission Required**: `payroll.run.unlock`
2. **Step-Up Authentication**: Mandatory TOTP step-up authentication active within the current session.
3. **Mandatory Justification**: A non-empty legal / financial audit justification string must be entered.
4. **Distinct Second Approver**: The unlocking user MUST specify a distinct user holding `payroll.run.unlock` who co-authorizes the action. Self-unlocking is strictly blocked at the engine layer.
5. **Published Runs**: A run already marked `published` CANNOT be unlocked directly; corrections must proceed via an Off-Cycle or Correction Run (`RB-PAY-06`).

---

## 2. Automated Engine Rollbacks
When the unlock transition (`locked -> review`) executes, the `LifecycleService.unlockRun()` automatically performs:
1. **YTD Aggregation Rollback**: Deducts constituent payslip line items from `payroll_ytd`.
2. **Input Status Reset**: Resets consumed inputs from `status = 'consumed'` back to `status = 'approved'` with `consumed_run_id = NULL`.
3. **Loan Recovery Rollback**: Resets recovered loan installments from `status = 'recovered'` back to `status = 'due'`.
4. **Cryptographic Invalidation**: Clears `run_hash` and marks existing pre-generated payslips as invalid.
5. **Audit Event Log**: Records `run.transition.locked_to_review` in `payroll_run_events` containing the second-approver ID and full justification reason.

---

## 3. Step-by-Step Operator Procedure
1. Navigate to **Payroll Operations > Closed Runs > Target Run**.
2. Click **Request Run Unlock**.
3. Complete Step-Up TOTP authentication.
4. Select the **Authorized Second Approver** from the dropdown list.
5. Type the formal justification (e.g., *"CA audit discovered retroactive tax exemption change for Karnataka tech unit"*).
6. Both approvers submit cryptographic approval.
7. Verify that status displays **In Review** and staged corrections can now be edited.
