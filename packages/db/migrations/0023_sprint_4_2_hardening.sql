-- Migration 0023: Sprint 4.2 hardening (expand-only; 0021/0022 are not edited).
--
-- Why: 0021 and 0022 created the Phase 4 payroll tables but never granted any privilege to
-- the application roles. Found by the real-database suite: hrms_app received
-- "permission denied" on every payroll table. This migration:
--   1. Grants least-privilege DML (no DELETE: Phase 4 uses soft delete) to hrms_app/hrms_worker.
--   2. Restricts payroll_run_events to SELECT + INSERT (AGENTS.md section 4, append-only),
--      in addition to the existing reject_update_delete trigger.
--   3. Adds composite FKs for payroll_inputs.consumed_run_id and
--      loan_installments.recovered_run_id so cross-tenant / dangling run references are impossible.
--
-- Reversible plan (documented, not auto-run):
--   ALTER TABLE payroll_inputs DROP CONSTRAINT fk_payroll_inputs_consumed_run;
--   ALTER TABLE loan_installments DROP CONSTRAINT fk_loan_installments_recovered_run;
--   REVOKE ALL ON <tables below> FROM hrms_app, hrms_worker;

-- 1. Mutable tenant tables: SELECT, INSERT, UPDATE (soft delete via deleted_at)
GRANT SELECT, INSERT, UPDATE ON
  legal_entities,
  payroll_settings,
  salary_components,
  salary_structures,
  employee_salary,
  salary_revisions,
  statutory_rule_sets,
  payroll_periods,
  payroll_runs,
  payroll_inputs,
  payroll_employee_runs,
  employee_loans,
  loan_installments
TO hrms_app, hrms_worker;

-- 2. Append-only run events: INSERT + SELECT only
GRANT SELECT, INSERT ON payroll_run_events TO hrms_app, hrms_worker;
REVOKE UPDATE, DELETE, TRUNCATE ON payroll_run_events FROM hrms_app, hrms_worker;

-- 3. Composite foreign keys for run references (nullable: MATCH SIMPLE skips NULLs)
ALTER TABLE payroll_inputs DROP CONSTRAINT IF EXISTS fk_payroll_inputs_consumed_run;
ALTER TABLE payroll_inputs
  ADD CONSTRAINT fk_payroll_inputs_consumed_run
  FOREIGN KEY (company_id, consumed_run_id)
  REFERENCES payroll_runs(company_id, id) ON DELETE RESTRICT;

ALTER TABLE loan_installments DROP CONSTRAINT IF EXISTS fk_loan_installments_recovered_run;
ALTER TABLE loan_installments
  ADD CONSTRAINT fk_loan_installments_recovered_run
  FOREIGN KEY (company_id, recovered_run_id)
  REFERENCES payroll_runs(company_id, id) ON DELETE RESTRICT;

-- Supporting indexes for the new FK columns (leading with company_id)
CREATE INDEX IF NOT EXISTS idx_payroll_inputs_consumed_run
  ON payroll_inputs (company_id, consumed_run_id) WHERE consumed_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loan_installments_recovered_run
  ON loan_installments (company_id, recovered_run_id) WHERE recovered_run_id IS NOT NULL;
