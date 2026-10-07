# Operational Runbook: Correction & Off-Cycle Payroll Runs

**Document ID**: `RB-PAY-06`  
**Target Roles**: Senior Payroll Operations, Finance Controller  
**Classification**: Post-Disbursement Correction Procedure  

---

## 1. When to Use Correction vs Off-Cycle Runs
Once a payroll run is published and disbursed to employees, it cannot be unlocked directly. Any corrections must proceed through a dedicated child run:

- **Off-Cycle Run (`run_type = 'off_cycle'`)**: Used for out-of-band payments such as festival bonuses, quarterly commissions, or ad-hoc performance awards without touching regular monthly base salary.
- **Correction Run (`run_type = 'correction'`)**: Used when errors are discovered in an already published regular run (e.g., missed LOP days, retrospective salary hikes, incorrect tax exemptions).

---

## 2. Difference Payslip Engine Mechanics
A correction run produces a **Difference Payslip**:
1. For each targeted employee, the engine computes what their payslip *should have been* for the target period.
2. It compares the revised lines against the already published payslip lines.
3. The resulting difference payslip contains only the **net incremental variances**:
   $$\Delta \text{Net} = \text{Revised Net} - \text{Original Disbursed Net}$$
4. If $\Delta \text{Net} > 0$: An incremental bank disbursement file is generated for the employee.
5. If $\Delta \text{Net} < 0$: Negative net handling policy applies:
   - `block`: Requires manual payroll override.
   - `carry_forward`: Automatically generates a pending deduction input for the subsequent monthly payroll period.

---

## 3. Step-by-Step Operator Guide
1. Navigate to **Payroll Operations > Runs > New Run**.
2. Select Run Type: **Correction Run** (or **Off-Cycle**).
3. Select Parent Published Run to correct.
4. Select the specific employee(s) requiring adjustment.
5. Enter revised attendance inputs, salary revision, or tax declaration overrides.
6. Trigger Calculation -> Review Console -> Approve -> Lock -> Publish.
7. YTD values are updated with the incremental differential.
