-- Migration 0022: Sprint 4.2 Payroll Runs, Inputs, Loans, and State Machine Tables
-- Implements Phase 4 Data Model with composite FKs, forced RLS, partial indexes, and append-only trigger for run events.

-- 1. Payroll Periods Table
CREATE TABLE IF NOT EXISTS payroll_periods (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  period text NOT NULL,
  fy text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  cutoff_date date NOT NULL,
  pay_date date NOT NULL,
  status text DEFAULT 'open' NOT NULL CHECK (status IN ('open', 'locked')),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_payroll_periods_company_id_id UNIQUE (company_id, id),
  CONSTRAINT uq_payroll_periods_entity_period UNIQUE (company_id, legal_entity_id, period),
  CONSTRAINT fk_payroll_periods_entity FOREIGN KEY (company_id, legal_entity_id) REFERENCES legal_entities(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_payroll_periods_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_payroll_periods_deleted ON payroll_periods (company_id) WHERE deleted_at IS NULL;

-- 2. Payroll Runs Table
CREATE TABLE IF NOT EXISTS payroll_runs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  period_id uuid NOT NULL,
  run_type text DEFAULT 'regular' NOT NULL CHECK (run_type IN ('regular', 'off_cycle', 'correction', 'final')),
  sequence integer DEFAULT 1 NOT NULL,
  status text DEFAULT 'draft' NOT NULL CHECK (status IN (
    'draft', 'inputs_ready', 'calculating', 'calculated', 'review',
    'approved', 'locking', 'locked', 'published', 'paid', 'cancelled'
  )),
  calc_version integer DEFAULT 1 NOT NULL,
  rule_versions jsonb DEFAULT '{}'::jsonb NOT NULL,
  settings_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
  engine_version text DEFAULT '1.0.0' NOT NULL,
  counts jsonb DEFAULT '{"total": 0, "included": 0, "held": 0, "excluded": 0, "errors": 0}'::jsonb NOT NULL,
  totals jsonb DEFAULT '{"gross": "0.00", "deductions": "0.00", "employerCost": "0.00", "net": "0.00"}'::jsonb NOT NULL,
  approved_by uuid,
  locked_by uuid,
  locked_at timestamptz,
  run_hash text,
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_payroll_runs_company_id_id UNIQUE (company_id, id),
  CONSTRAINT uq_payroll_runs_period_seq UNIQUE (company_id, period_id, run_type, sequence),
  CONSTRAINT fk_payroll_runs_period FOREIGN KEY (company_id, period_id) REFERENCES payroll_periods(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_payroll_runs_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_status ON payroll_runs (company_id, status);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_deleted ON payroll_runs (company_id) WHERE deleted_at IS NULL;

-- 3. Payroll Inputs Table
CREATE TABLE IF NOT EXISTS payroll_inputs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN (
    'bonus', 'incentive', 'arrear', 'deduction', 'loan_emi',
    'reimbursement', 'adjustment', 'lop_override', 'leave_encashment', 'other'
  )),
  component_code text,
  amount numeric(14,2) NOT NULL,
  taxable boolean DEFAULT true NOT NULL,
  for_period text NOT NULL,
  source_type text,
  source_id text,
  status text DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'approved', 'consumed', 'cancelled')),
  approved_by uuid,
  consumed_run_id uuid,
  note text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_payroll_inputs_company_id_id UNIQUE (company_id, id),
  CONSTRAINT fk_payroll_inputs_employee FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_payroll_inputs_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_inputs_source ON payroll_inputs (company_id, source_type, source_id)
  WHERE (source_type IS NOT NULL AND source_id IS NOT NULL AND deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS idx_payroll_inputs_status_period ON payroll_inputs (company_id, status, for_period);
CREATE INDEX IF NOT EXISTS idx_payroll_inputs_emp_period ON payroll_inputs (company_id, employee_id, for_period);
CREATE INDEX IF NOT EXISTS idx_payroll_inputs_deleted ON payroll_inputs (company_id) WHERE deleted_at IS NULL;

-- 4. Payroll Employee Runs Table (Staging Calculation Table)
CREATE TABLE IF NOT EXISTS payroll_employee_runs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  run_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  status text DEFAULT 'included' NOT NULL CHECK (status IN ('included', 'held', 'excluded', 'error')),
  hold_reason text,
  warnings jsonb DEFAULT '[]'::jsonb NOT NULL,
  blockers jsonb DEFAULT '[]'::jsonb NOT NULL,
  input_hash text,
  calc_version integer DEFAULT 1 NOT NULL,
  gross numeric(14,2) DEFAULT 0.00 NOT NULL,
  deductions numeric(14,2) DEFAULT 0.00 NOT NULL,
  employer_cost numeric(14,2) DEFAULT 0.00 NOT NULL,
  net numeric(14,2) DEFAULT 0.00 NOT NULL,
  result jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_payroll_employee_runs_company_id_id UNIQUE (company_id, id),
  CONSTRAINT uq_payroll_employee_runs_run_emp UNIQUE (company_id, run_id, employee_id),
  CONSTRAINT fk_payroll_employee_runs_run FOREIGN KEY (company_id, run_id) REFERENCES payroll_runs(company_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_payroll_employee_runs_employee FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_payroll_employee_runs_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_payroll_employee_runs_status ON payroll_employee_runs (company_id, run_id, status);
CREATE INDEX IF NOT EXISTS idx_payroll_employee_runs_deleted ON payroll_employee_runs (company_id) WHERE deleted_at IS NULL;

-- 5. Payroll Run Events Table (Append-only timeline)
CREATE TABLE IF NOT EXISTS payroll_run_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  run_id uuid NOT NULL,
  ts timestamptz DEFAULT now() NOT NULL,
  actor_id uuid NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  event text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT uq_payroll_run_events_company_id_id UNIQUE (company_id, id),
  CONSTRAINT fk_payroll_run_events_run FOREIGN KEY (company_id, run_id) REFERENCES payroll_runs(company_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_payroll_run_events_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_payroll_run_events_run_ts ON payroll_run_events (company_id, run_id, ts);

-- Append-only trigger on payroll_run_events
DROP TRIGGER IF EXISTS trg_payroll_run_events_no_update_delete ON payroll_run_events;
CREATE TRIGGER trg_payroll_run_events_no_update_delete
  BEFORE UPDATE OR DELETE ON payroll_run_events
  FOR EACH ROW EXECUTE FUNCTION reject_update_delete();

-- 6. Employee Loans Table
CREATE TABLE IF NOT EXISTS employee_loans (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  type text DEFAULT 'loan' NOT NULL CHECK (type IN ('loan', 'advance')),
  principal numeric(14,2) NOT NULL CHECK (principal > 0),
  interest_rate numeric(5,2) DEFAULT 0.00 NOT NULL CHECK (interest_rate >= 0),
  installments_count integer NOT NULL CHECK (installments_count > 0),
  emi_amount numeric(14,2) NOT NULL CHECK (emi_amount >= 0),
  start_period text NOT NULL,
  status text DEFAULT 'active' NOT NULL CHECK (status IN ('active', 'completed', 'paused', 'cancelled')),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_employee_loans_company_id_id UNIQUE (company_id, id),
  CONSTRAINT fk_employee_loans_employee FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_employee_loans_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_employee_loans_emp_status ON employee_loans (company_id, employee_id, status);
CREATE INDEX IF NOT EXISTS idx_employee_loans_deleted ON employee_loans (company_id) WHERE deleted_at IS NULL;

-- 7. Loan Installments Table
CREATE TABLE IF NOT EXISTS loan_installments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  loan_id uuid NOT NULL,
  installment_number integer NOT NULL CHECK (installment_number > 0),
  due_period text NOT NULL,
  principal_component numeric(14,2) NOT NULL CHECK (principal_component >= 0),
  interest_component numeric(14,2) NOT NULL CHECK (interest_component >= 0),
  total_amount numeric(14,2) NOT NULL CHECK (total_amount >= 0),
  status text DEFAULT 'due' NOT NULL CHECK (status IN ('due', 'recovered', 'skipped')),
  recovered_run_id uuid,
  recovered_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_loan_installments_company_id_id UNIQUE (company_id, id),
  CONSTRAINT uq_loan_installments_loan_inst UNIQUE (company_id, loan_id, installment_number),
  CONSTRAINT fk_loan_installments_loan FOREIGN KEY (company_id, loan_id) REFERENCES employee_loans(company_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_loan_installments_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_loan_installments_due_period ON loan_installments (company_id, due_period, status);
CREATE INDEX IF NOT EXISTS idx_loan_installments_deleted ON loan_installments (company_id) WHERE deleted_at IS NULL;

-- 8. Row Level Security Policies
ALTER TABLE payroll_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_periods FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payroll_periods_tenant_isolation ON payroll_periods;
CREATE POLICY payroll_periods_tenant_isolation ON payroll_periods
  FOR ALL
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payroll_runs_tenant_isolation ON payroll_runs;
CREATE POLICY payroll_runs_tenant_isolation ON payroll_runs
  FOR ALL
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE payroll_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_inputs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payroll_inputs_tenant_isolation ON payroll_inputs;
CREATE POLICY payroll_inputs_tenant_isolation ON payroll_inputs
  FOR ALL
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE payroll_employee_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_employee_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payroll_employee_runs_tenant_isolation ON payroll_employee_runs;
CREATE POLICY payroll_employee_runs_tenant_isolation ON payroll_employee_runs
  FOR ALL
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE payroll_run_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_run_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payroll_run_events_tenant_isolation ON payroll_run_events;
CREATE POLICY payroll_run_events_tenant_isolation ON payroll_run_events
  FOR ALL
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE employee_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_loans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_loans_tenant_isolation ON employee_loans;
CREATE POLICY employee_loans_tenant_isolation ON employee_loans
  FOR ALL
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE loan_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_installments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS loan_installments_tenant_isolation ON loan_installments;
CREATE POLICY loan_installments_tenant_isolation ON loan_installments
  FOR ALL
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);
