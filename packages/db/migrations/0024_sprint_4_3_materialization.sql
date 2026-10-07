-- Migration 0024: Sprint 4.3 Payslip Materialization, YTD, and Immutability Triggers
-- Up migration

-- Function to protect financial snapshot integrity of payslips while permitting lifecycle updates (pdf, publishing, payment)
CREATE OR REPLACE FUNCTION reject_payslip_financial_update()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payslips are immutable and cannot be deleted' USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.gross IS DISTINCT FROM NEW.gross OR
       OLD.net IS DISTINCT FROM NEW.net OR
       OLD.deductions IS DISTINCT FROM NEW.deductions OR
       OLD.employer_cost IS DISTINCT FROM NEW.employer_cost OR
       OLD.integrity_hash IS DISTINCT FROM NEW.integrity_hash OR
       OLD.snapshot IS DISTINCT FROM NEW.snapshot OR
       OLD.run_id IS DISTINCT FROM NEW.run_id OR
       OLD.employee_id IS DISTINCT FROM NEW.employee_id OR
       OLD.company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'financial figures, snapshot, and integrity hash of payslips are strictly immutable' USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1. Payslips Table (Immutable Financial Snapshot)
CREATE TABLE IF NOT EXISTS payslips (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  run_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  period text NOT NULL,
  gross numeric(14,2) NOT NULL,
  deductions numeric(14,2) NOT NULL,
  employer_cost numeric(14,2) NOT NULL,
  net numeric(14,2) NOT NULL,
  integrity_hash text NOT NULL,
  snapshot jsonb NOT NULL,
  pdf_file_id uuid,
  published_at timestamptz,
  payment_status text DEFAULT 'pending' NOT NULL CHECK (payment_status IN ('pending', 'paid', 'failed', 'returned')),
  payment_ref text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_payslips_company_id_id UNIQUE (company_id, id),
  CONSTRAINT uq_payslips_run_emp UNIQUE (company_id, run_id, employee_id),
  CONSTRAINT fk_payslips_run FOREIGN KEY (company_id, run_id) REFERENCES payroll_runs(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_payslips_employee FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_payslips_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_payslips_emp_period ON payslips (company_id, employee_id, period DESC);
CREATE INDEX IF NOT EXISTS idx_payslips_run ON payslips (company_id, run_id);
CREATE INDEX IF NOT EXISTS idx_payslips_deleted ON payslips (company_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_payslips_immutable_financials ON payslips;
CREATE TRIGGER trg_payslips_immutable_financials
  BEFORE UPDATE OR DELETE ON payslips
  FOR EACH ROW EXECUTE FUNCTION reject_payslip_financial_update();

-- 2. Payslip Lines Table (100% Immutable breakdown lines)
CREATE TABLE IF NOT EXISTS payslip_lines (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  payslip_id uuid NOT NULL,
  run_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  component_code text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('earning', 'deduction', 'employer_contribution', 'reimbursement')),
  amount numeric(14,2) NOT NULL,
  taxable_amount numeric(14,2) DEFAULT 0.00 NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  rule_ref text,
  created_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  CONSTRAINT uq_payslip_lines_company_id_id UNIQUE (company_id, id),
  CONSTRAINT fk_payslip_lines_payslip FOREIGN KEY (company_id, payslip_id) REFERENCES payslips(company_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_payslip_lines_run FOREIGN KEY (company_id, run_id) REFERENCES payroll_runs(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_payslip_lines_employee FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_payslip_lines_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_payslip_lines_run_comp ON payslip_lines (company_id, run_id, component_code);
CREATE INDEX IF NOT EXISTS idx_payslip_lines_emp_run ON payslip_lines (company_id, employee_id, run_id);
CREATE INDEX IF NOT EXISTS idx_payslip_lines_payslip ON payslip_lines (company_id, payslip_id);

DROP TRIGGER IF EXISTS trg_payslip_lines_no_update_delete ON payslip_lines;
CREATE TRIGGER trg_payslip_lines_no_update_delete
  BEFORE UPDATE OR DELETE ON payslip_lines
  FOR EACH ROW EXECUTE FUNCTION reject_update_delete();

-- 3. Payroll YTD Ledger Table
CREATE TABLE IF NOT EXISTS payroll_ytd (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  fy text NOT NULL,
  component_code text NOT NULL,
  amount numeric(14,2) NOT NULL,
  last_run_id uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT uq_payroll_ytd_company_id_id UNIQUE (company_id, id),
  CONSTRAINT uq_payroll_ytd_emp_fy_comp UNIQUE (company_id, employee_id, fy, component_code),
  CONSTRAINT fk_payroll_ytd_employee FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_payroll_ytd_run FOREIGN KEY (company_id, last_run_id) REFERENCES payroll_runs(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_payroll_ytd_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_payroll_ytd_lookup ON payroll_ytd (company_id, employee_id, fy);

-- 4. TDS Computations Table (Immutable per run)
CREATE TABLE IF NOT EXISTS tds_computations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  run_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  regime text NOT NULL CHECK (regime IN ('new', 'old')),
  annual_projection jsonb NOT NULL,
  tds_this_month numeric(14,2) NOT NULL,
  tds_ytd numeric(14,2) NOT NULL,
  remaining_months integer NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT uq_tds_computations_company_id_id UNIQUE (company_id, id),
  CONSTRAINT uq_tds_computations_run_emp UNIQUE (company_id, run_id, employee_id),
  CONSTRAINT fk_tds_computations_run FOREIGN KEY (company_id, run_id) REFERENCES payroll_runs(company_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_tds_computations_employee FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_tds_computations_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_tds_computations_lookup ON tds_computations (company_id, run_id, employee_id);

DROP TRIGGER IF EXISTS trg_tds_computations_no_update_delete ON tds_computations;
CREATE TRIGGER trg_tds_computations_no_update_delete
  BEFORE UPDATE OR DELETE ON tds_computations
  FOR EACH ROW EXECUTE FUNCTION reject_update_delete();

-- 5. Extra Indexes for Keyset Pagination and Set-Based Variance Queries
CREATE INDEX IF NOT EXISTS idx_payroll_employee_runs_variance ON payroll_employee_runs (company_id, run_id, status);
CREATE INDEX IF NOT EXISTS idx_payslips_variance ON payslips (company_id, run_id, employee_id);

-- 6. Row Level Security Policies
ALTER TABLE payslips ENABLE ROW LEVEL SECURITY;
ALTER TABLE payslips FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payslips_tenant_isolation ON payslips;
CREATE POLICY payslips_tenant_isolation ON payslips
  FOR ALL
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE payslip_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE payslip_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payslip_lines_tenant_isolation ON payslip_lines;
CREATE POLICY payslip_lines_tenant_isolation ON payslip_lines
  FOR ALL
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE payroll_ytd ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_ytd FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payroll_ytd_tenant_isolation ON payroll_ytd;
CREATE POLICY payroll_ytd_tenant_isolation ON payroll_ytd
  FOR ALL
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE tds_computations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tds_computations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tds_computations_tenant_isolation ON tds_computations;
CREATE POLICY tds_computations_tenant_isolation ON tds_computations
  FOR ALL
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

-- 7. Runtime Grants to hrms_app non-owner role
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON payslips TO hrms_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON payslip_lines TO hrms_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_ytd TO hrms_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON tds_computations TO hrms_app;
  END IF;
END $$;
