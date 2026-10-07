-- Migration 0026: Sprint 4.5 Tax Declarations, Statutory Filings, Opening Balances, and Reconciliation Tables
-- Enforces Row Level Security and composite foreign keys on all tenant tables

-- 1. deduction_catalog
CREATE TABLE IF NOT EXISTS deduction_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  section_ref TEXT NOT NULL,
  max_limit NUMERIC(14, 2),
  regimes JSONB NOT NULL DEFAULT '["old"]'::jsonb,
  requires_proof BOOLEAN NOT NULL DEFAULT true,
  declaration_window_start DATE,
  declaration_window_end DATE,
  proof_window_start DATE,
  proof_window_end DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  deleted_at TIMESTAMPTZ,
  row_version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT uq_deduction_catalog_company_id UNIQUE (company_id, id),
  CONSTRAINT uq_deduction_catalog_code UNIQUE (company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_deduction_catalog_company ON deduction_catalog (company_id) WHERE deleted_at IS NULL;

ALTER TABLE deduction_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE deduction_catalog FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deduction_catalog_tenant_isolation ON deduction_catalog;
CREATE POLICY deduction_catalog_tenant_isolation ON deduction_catalog
  FOR ALL
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON deduction_catalog TO hrms_app;

-- 2. tax_declarations
CREATE TABLE IF NOT EXISTS tax_declarations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  fy TEXT NOT NULL,
  regime TEXT NOT NULL DEFAULT 'new' CHECK (regime IN ('new', 'old')),
  regime_form_ref TEXT DEFAULT 'Form 122',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'verified', 'locked')),
  submitted_at TIMESTAMPTZ,
  previous_employer JSONB NOT NULL DEFAULT '{}'::jsonb,
  hra_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  deleted_at TIMESTAMPTZ,
  row_version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT uq_tax_declarations_company_id UNIQUE (company_id, id),
  CONSTRAINT uq_tax_declarations_emp_fy UNIQUE (company_id, employee_id, fy),
  CONSTRAINT fk_tax_declarations_employee FOREIGN KEY (company_id, employee_id)
    REFERENCES employees(company_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_tax_declarations_emp_fy ON tax_declarations (company_id, employee_id, fy) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tax_declarations_status ON tax_declarations (company_id, status) WHERE deleted_at IS NULL;

ALTER TABLE tax_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_declarations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tax_declarations_tenant_isolation ON tax_declarations;
CREATE POLICY tax_declarations_tenant_isolation ON tax_declarations
  FOR ALL
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON tax_declarations TO hrms_app;

-- 3. tax_declaration_items
CREATE TABLE IF NOT EXISTS tax_declaration_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  declaration_id UUID NOT NULL,
  deduction_code TEXT NOT NULL,
  amount_declared NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  amount_verified NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  proof_status TEXT NOT NULL DEFAULT 'none' CHECK (proof_status IN ('none', 'uploaded', 'verified', 'rejected')),
  proof_file_id UUID,
  notes TEXT,
  rejection_reason TEXT,
  verified_by UUID,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  deleted_at TIMESTAMPTZ,
  row_version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT uq_tax_declaration_items_company_id UNIQUE (company_id, id),
  CONSTRAINT uq_tax_declaration_items_code UNIQUE (company_id, declaration_id, deduction_code),
  CONSTRAINT fk_tax_declaration_items_declaration FOREIGN KEY (company_id, declaration_id)
    REFERENCES tax_declarations(company_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tax_declaration_items_decl ON tax_declaration_items (company_id, declaration_id) WHERE deleted_at IS NULL;

ALTER TABLE tax_declaration_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_declaration_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tax_declaration_items_tenant_isolation ON tax_declaration_items;
CREATE POLICY tax_declaration_items_tenant_isolation ON tax_declaration_items
  FOR ALL
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON tax_declaration_items TO hrms_app;

-- 4. statutory_filings
CREATE TABLE IF NOT EXISTS statutory_filings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('PF_ECR', 'ESI_CONTRIBUTION', 'PT_SUMMARY', 'LWF_SUMMARY', 'TDS_RETURN_DATA', 'TDS_CERTIFICATE_DATA')),
  period TEXT NOT NULL,
  fy TEXT NOT NULL,
  run_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  file_id UUID,
  totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  reconciled_with_run BOOLEAN NOT NULL DEFAULT true,
  mismatch_details JSONB DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'generated' CHECK (status IN ('generated', 'reconciled', 'filed_by_ca', 'cancelled')),
  challan_reference TEXT,
  challan_date DATE,
  challan_amount NUMERIC(14, 2),
  notes TEXT,
  generated_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  deleted_at TIMESTAMPTZ,
  row_version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT uq_statutory_filings_company_id UNIQUE (company_id, id)
);

CREATE INDEX IF NOT EXISTS idx_statutory_filings_period_type ON statutory_filings (company_id, type, period) WHERE deleted_at IS NULL;

ALTER TABLE statutory_filings ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory_filings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS statutory_filings_tenant_isolation ON statutory_filings;
CREATE POLICY statutory_filings_tenant_isolation ON statutory_filings
  FOR ALL
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON statutory_filings TO hrms_app;

-- 5. payroll_opening_balances
CREATE TABLE IF NOT EXISTS payroll_opening_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  fy TEXT NOT NULL,
  as_of_period TEXT NOT NULL,
  component_code TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  tds_deducted NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
  pf_ytd NUMERIC(14, 2) DEFAULT 0.00,
  esi_ytd NUMERIC(14, 2) DEFAULT 0.00,
  pt_ytd NUMERIC(14, 2) DEFAULT 0.00,
  source TEXT NOT NULL DEFAULT 'import',
  import_job_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reverted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  CONSTRAINT uq_payroll_opening_balances_company_id UNIQUE (company_id, id),
  CONSTRAINT uq_payroll_opening_balances_unique UNIQUE (company_id, employee_id, fy, component_code, import_job_id),
  CONSTRAINT fk_payroll_opening_balances_emp FOREIGN KEY (company_id, employee_id)
    REFERENCES employees(company_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_payroll_opening_balances_emp_fy ON payroll_opening_balances (company_id, employee_id, fy);
CREATE INDEX IF NOT EXISTS idx_payroll_opening_balances_job ON payroll_opening_balances (company_id, import_job_id);

ALTER TABLE payroll_opening_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_opening_balances FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_opening_balances_tenant_isolation ON payroll_opening_balances;
CREATE POLICY payroll_opening_balances_tenant_isolation ON payroll_opening_balances
  FOR ALL
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_opening_balances TO hrms_app;

-- 6. recon_cycles
CREATE TABLE IF NOT EXISTS recon_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  period TEXT NOT NULL,
  run_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'signed', 'rejected')),
  tolerance NUMERIC(14, 2) NOT NULL DEFAULT 1.00,
  signed_by_ca UUID,
  signed_by_ca_at TIMESTAMPTZ,
  signed_by_finance UUID,
  signed_by_finance_at TIMESTAMPTZ,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,
  deleted_at TIMESTAMPTZ,
  row_version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT uq_recon_cycles_company_id UNIQUE (company_id, id),
  CONSTRAINT uq_recon_cycles_period_run UNIQUE (company_id, period, run_id),
  CONSTRAINT fk_recon_cycles_run FOREIGN KEY (company_id, run_id)
    REFERENCES payroll_runs(company_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_recon_cycles_period ON recon_cycles (company_id, period) WHERE deleted_at IS NULL;

ALTER TABLE recon_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon_cycles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recon_cycles_tenant_isolation ON recon_cycles;
CREATE POLICY recon_cycles_tenant_isolation ON recon_cycles
  FOR ALL
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON recon_cycles TO hrms_app;

-- 7. recon_imports
CREATE TABLE IF NOT EXISTS recon_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  cycle_id UUID NOT NULL,
  filename TEXT NOT NULL,
  column_mapping JSONB NOT NULL DEFAULT '{}'::jsonb,
  row_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  CONSTRAINT uq_recon_imports_company_id UNIQUE (company_id, id),
  CONSTRAINT fk_recon_imports_cycle FOREIGN KEY (company_id, cycle_id)
    REFERENCES recon_cycles(company_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recon_imports_cycle ON recon_imports (company_id, cycle_id);

ALTER TABLE recon_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon_imports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recon_imports_tenant_isolation ON recon_imports;
CREATE POLICY recon_imports_tenant_isolation ON recon_imports
  FOR ALL
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON recon_imports TO hrms_app;

-- 8. recon_diffs
CREATE TABLE IF NOT EXISTS recon_diffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  cycle_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  component_code TEXT NOT NULL,
  ours_amount NUMERIC(14, 2) NOT NULL,
  theirs_amount NUMERIC(14, 2) NOT NULL,
  diff NUMERIC(14, 2) NOT NULL,
  category TEXT NOT NULL DEFAULT 'rounding' CHECK (category IN ('rounding', 'rule_difference', 'input_difference', 'engine_bug', 'source_error', 'timing')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'explained', 'accepted', 'fixed')),
  explanation TEXT,
  explained_by UUID,
  explained_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_recon_diffs_company_id UNIQUE (company_id, id),
  CONSTRAINT uq_recon_diffs_unique UNIQUE (company_id, cycle_id, employee_id, component_code),
  CONSTRAINT fk_recon_diffs_cycle FOREIGN KEY (company_id, cycle_id)
    REFERENCES recon_cycles(company_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_recon_diffs_employee FOREIGN KEY (company_id, employee_id)
    REFERENCES employees(company_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_recon_diffs_cycle_status ON recon_diffs (company_id, cycle_id, status);
CREATE INDEX IF NOT EXISTS idx_recon_diffs_emp ON recon_diffs (company_id, employee_id);

ALTER TABLE recon_diffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE recon_diffs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recon_diffs_tenant_isolation ON recon_diffs;
CREATE POLICY recon_diffs_tenant_isolation ON recon_diffs
  FOR ALL
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON recon_diffs TO hrms_app;
