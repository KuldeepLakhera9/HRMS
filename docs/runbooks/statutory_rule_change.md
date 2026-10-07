# Operational Runbook: Statutory Rule Change & Effective Dating

**Document ID**: `RB-PAY-03`  
**Target Roles**: Compliance Officer, Chartered Accountant, Payroll Admin  
**Classification**: Regulatory Compliance Procedure  

---

## 1. Statutory Rules Architecture
In OrgHub HRMS, statutory calculation rules (EPF, ESI, Professional Tax, Labour Welfare Fund, Income Tax TDS, Gratuity, Bonus) are NEVER hard-coded. They are managed through externalized, version-controlled rule payload catalogs (`statutory_rule_sets`):

- **Rule Key Schema**: e.g., `PF_IN`, `ESI_IN`, `PT_KA`, `PT_MH`, `TDS_IN`, `LWF_KA`, `GRATUITY_IN`.
- **Validation**: Strict server-side Zod schema validation via `rulePayloadValidators`.
- **Effective Dating**: Every rule version specifies `effective_from` (and optional `effective_to`).
- **Segregation of Duties**: The user who drafts a rule change CANNOT approve it (`assertSegregationOfDuties`).

---

## 2. Procedure for Introducing a Rule Change

### Step 1: Draft the Version
1. Navigate to **Statutory Rules Admin > Select Rule Key** (e.g., `PT_KA`).
2. Click **Create Draft Version**.
3. Set the official gazette `effective_from` date (e.g., `2026-06-01`).
4. Update the JSON payload (e.g., modifying Karnataka PT upper slab threshold).

### Step 2: Impact Simulation & Diff Review
1. Click **Simulate Impact**.
2. The system executes `simulateRuleImpact()`, running the active employee cohort through both the active and drafted rule versions.
3. Review the **Variance Summary**:
   - Total employees affected
   - Net variance in statutory contributions
   - Slabs diff view

### Step 3: Dual Authorization & Activation
1. Compliance Lead submits draft for review (`status = 'pending_approval'`).
2. An authorized Chartered Accountant or Finance Director holding `payroll.rules.approve` performs Step-Up auth.
3. Approver clicks **Approve & Activate**.
4. Status transitions to `active`. Subsequent payroll runs for periods on or after `effective_from` automatically bind the new version snapshot.
