-- Migration 0025: Sprint 4.4 Lifecycle (Unlock/Publish), Bank Advice & Expenses
-- Up migration

-- 1. Update Payslip Immutability Trigger to allow authorized unlock rollback
CREATE OR REPLACE FUNCTION reject_payslip_financial_update()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.allow_unlock', true) = 'true' THEN
      RETURN OLD;
    ELSE
      RAISE EXCEPTION 'payslips are immutable and cannot be deleted' USING ERRCODE = '55000';
    END IF;
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

-- 2. Update Payslip Lines Trigger to allow authorized unlock rollback
CREATE OR REPLACE FUNCTION reject_payslip_lines_update_delete()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('app.allow_unlock', true) = 'true' THEN
      RETURN OLD;
    ELSE
      RAISE EXCEPTION 'payslip_lines are append-only' USING ERRCODE = '55000';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'payslip_lines are append-only and cannot be updated' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payslip_lines_no_update_delete ON payslip_lines;
CREATE TRIGGER trg_payslip_lines_no_update_delete
  BEFORE UPDATE OR DELETE ON payslip_lines
  FOR EACH ROW EXECUTE FUNCTION reject_payslip_lines_update_delete();

-- 3. Bank Format Templates
CREATE TABLE IF NOT EXISTS bank_format_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  name text NOT NULL,
  bank_code text NOT NULL,
  columns_mapping jsonb NOT NULL,
  delimiter text DEFAULT ',' NOT NULL,
  has_header boolean DEFAULT true NOT NULL,
  has_footer boolean DEFAULT false NOT NULL,
  validations jsonb DEFAULT '{}'::jsonb NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_bank_format_templates_company_id UNIQUE (company_id, id),
  CONSTRAINT fk_bank_format_templates_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_bank_format_templates_company ON bank_format_templates (company_id) WHERE deleted_at IS NULL;

-- 4. Bank Advice Files
CREATE TABLE IF NOT EXISTS bank_advice_files (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  run_id uuid NOT NULL,
  format_template_id uuid NOT NULL,
  file_id uuid,
  checksum text NOT NULL,
  record_count integer NOT NULL,
  total_amount numeric(14,2) NOT NULL,
  status text DEFAULT 'generated' NOT NULL CHECK (status IN ('generated', 'downloaded', 'sent', 'confirmed', 'cancelled')),
  version integer DEFAULT 1 NOT NULL,
  reason_for_regeneration text,
  encrypted_payload text,
  generated_by uuid NOT NULL,
  approved_by uuid,
  downloaded_at timestamptz,
  download_count integer DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_bank_advice_files_company_id UNIQUE (company_id, id),
  CONSTRAINT fk_bank_advice_files_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bank_advice_files_run FOREIGN KEY (company_id, run_id) REFERENCES payroll_runs(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_bank_advice_files_template FOREIGN KEY (company_id, format_template_id) REFERENCES bank_format_templates(company_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_bank_advice_files_run ON bank_advice_files (company_id, run_id);
CREATE INDEX IF NOT EXISTS idx_bank_advice_files_status ON bank_advice_files (company_id, status);

-- 5. Payment Confirmations
CREATE TABLE IF NOT EXISTS payment_confirmations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  advice_file_id uuid NOT NULL,
  run_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  utr text NOT NULL,
  status text NOT NULL CHECK (status IN ('success', 'failed', 'returned')),
  amount numeric(14,2) NOT NULL,
  failure_reason text,
  confirmed_at timestamptz DEFAULT now() NOT NULL,
  imported_by uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT uq_payment_confirmations_company_id UNIQUE (company_id, id),
  CONSTRAINT fk_payment_confirmations_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payment_confirmations_advice FOREIGN KEY (company_id, advice_file_id) REFERENCES bank_advice_files(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_payment_confirmations_run FOREIGN KEY (company_id, run_id) REFERENCES payroll_runs(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_payment_confirmations_emp FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_payment_confirmations_run ON payment_confirmations (company_id, run_id);
CREATE INDEX IF NOT EXISTS idx_payment_confirmations_emp ON payment_confirmations (company_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_payment_confirmations_utr ON payment_confirmations (company_id, utr);

-- 6. Expense Categories
CREATE TABLE IF NOT EXISTS expense_categories (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  per_claim_limit numeric(14,2),
  per_month_limit numeric(14,2),
  bill_required_above numeric(14,2) DEFAULT 0.00 NOT NULL,
  taxable boolean DEFAULT false NOT NULL,
  gl_code text,
  allowed_grades jsonb DEFAULT '[]'::jsonb NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_expense_categories_company_id UNIQUE (company_id, id),
  CONSTRAINT uq_expense_categories_code UNIQUE (company_id, code),
  CONSTRAINT fk_expense_categories_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_expense_categories_company ON expense_categories (company_id) WHERE deleted_at IS NULL;

-- 7. Expense Policies
CREATE TABLE IF NOT EXISTS expense_policies (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  category_id uuid NOT NULL,
  grade_id uuid,
  limits jsonb DEFAULT '{}'::jsonb NOT NULL,
  rules jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_expense_policies_company_id UNIQUE (company_id, id),
  CONSTRAINT fk_expense_policies_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_expense_policies_category FOREIGN KEY (company_id, category_id) REFERENCES expense_categories(company_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_expense_policies_cat ON expense_policies (company_id, category_id);

-- 8. Expense Claims
CREATE TABLE IF NOT EXISTS expense_claims (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  claim_no text NOT NULL,
  title text NOT NULL,
  status text DEFAULT 'draft' NOT NULL CHECK (status IN ('draft', 'submitted', 'approved', 'partially_approved', 'rejected', 'paid', 'cancelled')),
  total_claimed numeric(14,2) DEFAULT 0.00 NOT NULL,
  total_approved numeric(14,2) DEFAULT 0.00 NOT NULL,
  workflow_request_id uuid,
  payout_mode text DEFAULT 'payroll' NOT NULL CHECK (payout_mode IN ('payroll', 'bank')),
  payout_ref text,
  submitted_at timestamptz,
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_expense_claims_company_id UNIQUE (company_id, id),
  CONSTRAINT uq_expense_claims_claim_no UNIQUE (company_id, claim_no),
  CONSTRAINT fk_expense_claims_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_expense_claims_emp FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_expense_claims_emp ON expense_claims (company_id, employee_id, status);
CREATE INDEX IF NOT EXISTS idx_expense_claims_status ON expense_claims (company_id, status);

-- 9. Expense Items
CREATE TABLE IF NOT EXISTS expense_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  expense_date date NOT NULL,
  category_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL,
  merchant text,
  description text,
  bill_file_id uuid,
  bill_hash text,
  policy_flags jsonb DEFAULT '[]'::jsonb NOT NULL,
  approved_amount numeric(14,2) DEFAULT 0.00 NOT NULL,
  status text DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_expense_items_company_id UNIQUE (company_id, id),
  CONSTRAINT fk_expense_items_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
  CONSTRAINT fk_expense_items_claim FOREIGN KEY (company_id, claim_id) REFERENCES expense_claims(company_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_expense_items_cat FOREIGN KEY (company_id, category_id) REFERENCES expense_categories(company_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_expense_items_claim ON expense_items (company_id, claim_id);
CREATE INDEX IF NOT EXISTS idx_expense_items_hash ON expense_items (company_id, bill_hash) WHERE bill_hash IS NOT NULL;

-- 10. Enable and Force Row Level Security on all new tables
ALTER TABLE bank_format_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_format_templates FORCE ROW LEVEL SECURITY;

ALTER TABLE bank_advice_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_advice_files FORCE ROW LEVEL SECURITY;

ALTER TABLE payment_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_confirmations FORCE ROW LEVEL SECURITY;

ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_categories FORCE ROW LEVEL SECURITY;

ALTER TABLE expense_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_policies FORCE ROW LEVEL SECURITY;

ALTER TABLE expense_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_claims FORCE ROW LEVEL SECURITY;

ALTER TABLE expense_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_items FORCE ROW LEVEL SECURITY;

-- 11. RLS Policies
DROP POLICY IF EXISTS tenant_isolation_policy ON bank_format_templates;
CREATE POLICY tenant_isolation_policy ON bank_format_templates
  FOR ALL TO PUBLIC
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON bank_advice_files;
CREATE POLICY tenant_isolation_policy ON bank_advice_files
  FOR ALL TO PUBLIC
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON payment_confirmations;
CREATE POLICY tenant_isolation_policy ON payment_confirmations
  FOR ALL TO PUBLIC
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON expense_categories;
CREATE POLICY tenant_isolation_policy ON expense_categories
  FOR ALL TO PUBLIC
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON expense_policies;
CREATE POLICY tenant_isolation_policy ON expense_policies
  FOR ALL TO PUBLIC
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON expense_claims;
CREATE POLICY tenant_isolation_policy ON expense_claims
  FOR ALL TO PUBLIC
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

DROP POLICY IF EXISTS tenant_isolation_policy ON expense_items;
CREATE POLICY tenant_isolation_policy ON expense_items
  FOR ALL TO PUBLIC
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

-- 11. Runtime Grants to hrms_app non-owner role
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON bank_format_templates TO hrms_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON bank_advice_files TO hrms_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON payment_confirmations TO hrms_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON expense_categories TO hrms_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON expense_policies TO hrms_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON expense_claims TO hrms_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON expense_items TO hrms_app;
  END IF;
END $$;
