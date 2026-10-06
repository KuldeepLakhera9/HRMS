-- Migration 0021: Sprint 4.1 Payroll Foundations (Legal Entities, Settings, Components, Structures, Salaries, Rules)
-- Implements Phase 4 Data Model with composite FKs, forced RLS, exclusion constraints for non-overlapping assignments and rules.

-- 1. Alter employees table to add legal_entity_id
ALTER TABLE employees ADD COLUMN IF NOT EXISTS legal_entity_id uuid;

-- 2. Legal Entities Table
CREATE TABLE IF NOT EXISTS legal_entities (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  name text NOT NULL,
  pan text NOT NULL,
  tan text NOT NULL,
  pf_establishment_id text,
  esi_code text,
  registrations jsonb DEFAULT '{}'::jsonb NOT NULL,
  address jsonb DEFAULT '{}'::jsonb NOT NULL,
  default_bank_account_enc text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_legal_entities_company_id_id UNIQUE (company_id, id),
  CONSTRAINT uq_legal_entities_company_pan UNIQUE (company_id, pan),
  CONSTRAINT fk_legal_entities_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_legal_entities_deleted ON legal_entities (company_id) WHERE deleted_at IS NULL;

-- 3. Payroll Settings Table
CREATE TABLE IF NOT EXISTS payroll_settings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  pay_cycle text DEFAULT 'monthly' NOT NULL CHECK (pay_cycle IN ('monthly')),
  pay_day integer DEFAULT 30 NOT NULL CHECK (pay_day BETWEEN 1 AND 31),
  paid_days_basis text DEFAULT 'calendar' NOT NULL CHECK (paid_days_basis IN ('calendar', 'fixed_30', 'working_days')),
  proration_mode text DEFAULT 'prorate_earnings' NOT NULL CHECK (proration_mode IN ('prorate_earnings', 'deduct_lop')),
  rounding_defaults jsonb DEFAULT '{}'::jsonb NOT NULL,
  fy_start_month integer DEFAULT 4 NOT NULL CHECK (fy_start_month BETWEEN 1 AND 12),
  labour_code_wages jsonb DEFAULT '{"enabled": false, "floorPct": 50}'::jsonb NOT NULL,
  pf_enabled boolean DEFAULT true NOT NULL,
  esi_enabled boolean DEFAULT true NOT NULL,
  pt_enabled boolean DEFAULT true NOT NULL,
  lwf_enabled boolean DEFAULT true NOT NULL,
  sod jsonb DEFAULT '{"strict": true}'::jsonb NOT NULL,
  negative_net_policy text DEFAULT 'block' NOT NULL CHECK (negative_net_policy IN ('block', 'hold', 'carry_forward')),
  working_days_source text DEFAULT 'attendance_days' NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_payroll_settings_company_id_id UNIQUE (company_id, id),
  CONSTRAINT uq_payroll_settings_company_entity UNIQUE (company_id, legal_entity_id),
  CONSTRAINT fk_payroll_settings_entity FOREIGN KEY (company_id, legal_entity_id) REFERENCES legal_entities(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_payroll_settings_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_payroll_settings_deleted ON payroll_settings (company_id) WHERE deleted_at IS NULL;

-- 4. Salary Components Table
CREATE TABLE IF NOT EXISTS salary_components (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('earning', 'deduction', 'employer_contribution', 'reimbursement', 'benefit')),
  calc text NOT NULL CHECK (calc IN ('fixed', 'formula', 'slab', 'input')),
  formula text,
  rounding text DEFAULT 'half_up' NOT NULL CHECK (rounding IN ('half_up', 'floor', 'ceil')),
  round_target text DEFAULT 'rupee' NOT NULL CHECK (round_target IN ('rupee', 'paisa')),
  taxable boolean DEFAULT true NOT NULL,
  tax_exemption_rule jsonb,
  pf_wage boolean DEFAULT false NOT NULL,
  esi_wage boolean DEFAULT false NOT NULL,
  gratuity_wage boolean DEFAULT false NOT NULL,
  bonus_wage boolean DEFAULT false NOT NULL,
  statutory_wage boolean DEFAULT false NOT NULL,
  prorate boolean DEFAULT true NOT NULL,
  show_on_payslip boolean DEFAULT true NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  version integer DEFAULT 1 NOT NULL,
  status text DEFAULT 'draft' NOT NULL CHECK (status IN ('draft', 'approved')),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_salary_components_company_id_id UNIQUE (company_id, id),
  CONSTRAINT uq_salary_components_code_ver UNIQUE (company_id, code, version),
  CONSTRAINT fk_salary_components_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_salary_components_status ON salary_components (company_id, status);
CREATE INDEX IF NOT EXISTS idx_salary_components_deleted ON salary_components (company_id) WHERE deleted_at IS NULL;

-- 5. Salary Structures Table
CREATE TABLE IF NOT EXISTS salary_structures (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  name text NOT NULL,
  version integer DEFAULT 1 NOT NULL,
  components jsonb NOT NULL,
  validations jsonb DEFAULT '{}'::jsonb NOT NULL,
  status text DEFAULT 'draft' NOT NULL CHECK (status IN ('draft', 'approved', 'retired')),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_salary_structures_company_id_id UNIQUE (company_id, id),
  CONSTRAINT uq_salary_structures_name_ver UNIQUE (company_id, name, version),
  CONSTRAINT fk_salary_structures_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_salary_structures_status ON salary_structures (company_id, status);
CREATE INDEX IF NOT EXISTS idx_salary_structures_deleted ON salary_structures (company_id) WHERE deleted_at IS NULL;

-- 6. Employee Salary Assignment Table
CREATE TABLE IF NOT EXISTS employee_salary (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  structure_id uuid NOT NULL,
  structure_version integer NOT NULL,
  ctc_annual numeric(14,2) NOT NULL CHECK (ctc_annual >= 0),
  overrides jsonb DEFAULT '{}'::jsonb NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  reason text DEFAULT 'join' NOT NULL CHECK (reason IN ('join', 'revision', 'promotion', 'correction')),
  status text DEFAULT 'draft' NOT NULL CHECK (status IN ('draft', 'approved', 'rejected')),
  maker_id uuid NOT NULL,
  checker_id uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_employee_salary_company_id_id UNIQUE (company_id, id),
  CONSTRAINT fk_employee_salary_employee FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_employee_salary_structure FOREIGN KEY (company_id, structure_id) REFERENCES salary_structures(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_employee_salary_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_employee_salary_emp_effective ON employee_salary (company_id, employee_id, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_employee_salary_deleted ON employee_salary (company_id) WHERE deleted_at IS NULL;

-- Exclusion Constraint on employee_salary: No overlapping approved salaries per employee
ALTER TABLE employee_salary DROP CONSTRAINT IF EXISTS no_overlapping_approved_salaries;
ALTER TABLE employee_salary ADD CONSTRAINT no_overlapping_approved_salaries
EXCLUDE USING gist (
  company_id WITH =,
  employee_id WITH =,
  daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
) WHERE (status = 'approved' AND deleted_at IS NULL);

-- 7. Salary Revisions Table
CREATE TABLE IF NOT EXISTS salary_revisions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  batch_id text NOT NULL,
  effective_from date NOT NULL,
  rows jsonb NOT NULL,
  status text DEFAULT 'draft' NOT NULL CHECK (status IN ('draft', 'previewed', 'approved', 'applied', 'rejected')),
  arrears_policy jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_salary_revisions_company_id_id UNIQUE (company_id, id),
  CONSTRAINT uq_salary_revisions_batch UNIQUE (company_id, batch_id),
  CONSTRAINT fk_salary_revisions_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_salary_revisions_status ON salary_revisions (company_id, status);
CREATE INDEX IF NOT EXISTS idx_salary_revisions_deleted ON salary_revisions (company_id) WHERE deleted_at IS NULL;

-- 8. Statutory Rule Sets Table
CREATE TABLE IF NOT EXISTS statutory_rule_sets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  key text NOT NULL,
  version integer DEFAULT 1 NOT NULL,
  jurisdiction text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  payload jsonb NOT NULL,
  status text DEFAULT 'draft' NOT NULL CHECK (status IN ('draft', 'pending_approval', 'active', 'retired')),
  maker_id uuid NOT NULL,
  checker_id uuid,
  ca_verified_by text,
  ca_verified_on timestamptz,
  source_note text,
  test_cases jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_statutory_rule_sets_company_id_id UNIQUE (company_id, id),
  CONSTRAINT uq_statutory_rule_sets_key_ver UNIQUE (company_id, key, jurisdiction, version),
  CONSTRAINT fk_statutory_rule_sets_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_statutory_rule_sets_status ON statutory_rule_sets (company_id, key, status);
CREATE INDEX IF NOT EXISTS idx_statutory_rule_sets_deleted ON statutory_rule_sets (company_id) WHERE deleted_at IS NULL;

-- Exclusion Constraint on statutory_rule_sets: No overlapping active rules per key and jurisdiction
ALTER TABLE statutory_rule_sets DROP CONSTRAINT IF EXISTS no_overlapping_active_rules;
ALTER TABLE statutory_rule_sets ADD CONSTRAINT no_overlapping_active_rules
EXCLUDE USING gist (
  company_id WITH =,
  key WITH =,
  jurisdiction WITH =,
  daterange(effective_from, COALESCE(effective_to, 'infinity'::date), '[]') WITH &&
) WHERE (status = 'active' AND deleted_at IS NULL);

-- 9. Row Level Security Policies
ALTER TABLE legal_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE legal_entities FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_entities_tenant_isolation ON legal_entities;
CREATE POLICY legal_entities_tenant_isolation ON legal_entities
  FOR ALL
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE payroll_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payroll_settings_tenant_isolation ON payroll_settings;
CREATE POLICY payroll_settings_tenant_isolation ON payroll_settings
  FOR ALL
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE salary_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_components FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS salary_components_tenant_isolation ON salary_components;
CREATE POLICY salary_components_tenant_isolation ON salary_components
  FOR ALL
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE salary_structures ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_structures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS salary_structures_tenant_isolation ON salary_structures;
CREATE POLICY salary_structures_tenant_isolation ON salary_structures
  FOR ALL
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE employee_salary ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_salary FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_salary_tenant_isolation ON employee_salary;
CREATE POLICY employee_salary_tenant_isolation ON employee_salary
  FOR ALL
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE salary_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_revisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS salary_revisions_tenant_isolation ON salary_revisions;
CREATE POLICY salary_revisions_tenant_isolation ON salary_revisions
  FOR ALL
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);

ALTER TABLE statutory_rule_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory_rule_sets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS statutory_rule_sets_tenant_isolation ON statutory_rule_sets;
CREATE POLICY statutory_rule_sets_tenant_isolation ON statutory_rule_sets
  FOR ALL
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);
