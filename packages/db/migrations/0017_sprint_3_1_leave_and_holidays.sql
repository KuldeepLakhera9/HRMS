-- Migration 0017: Sprint 3.1 Leave, Calendars, Holidays, Comp-off and Attendance Period Summary
-- Implements Phase 3 Section 4 Data Model with composite FKs, forced RLS, append-only trigger, and exclusion constraints.

-- 1. Alter existing tables
ALTER TABLE shifts ADD COLUMN IF NOT EXISTS weekly_off_rules jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE attendance_days ADD COLUMN IF NOT EXISTS lop_days numeric(4,2) DEFAULT 0.00 NOT NULL;
ALTER TABLE attendance_days ADD COLUMN IF NOT EXISTS leave_portion numeric(3,2) DEFAULT 0.00 NOT NULL;
ALTER TABLE attendance_days ADD COLUMN IF NOT EXISTS holiday_id uuid;

-- 2. Leave Types
CREATE TABLE IF NOT EXISTS leave_types (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  is_paid boolean DEFAULT true NOT NULL,
  unit text DEFAULT 'day' NOT NULL CHECK (unit IN ('day', 'hour')),
  allow_half_day boolean DEFAULT true NOT NULL,
  allow_hourly boolean DEFAULT false NOT NULL,
  requires_document_after_days integer,
  max_consecutive_days integer,
  min_notice_days integer DEFAULT 0 NOT NULL,
  sandwich_rule text DEFAULT 'none' NOT NULL CHECK (sandwich_rule IN ('none', 'holidays', 'weekly_offs', 'both')),
  allow_negative_balance boolean DEFAULT false NOT NULL,
  negative_limit numeric(7,3) DEFAULT 0.000 NOT NULL,
  applicable_to jsonb DEFAULT '{}'::jsonb NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_leave_types_company_id_id UNIQUE (company_id, id),
  CONSTRAINT uq_leave_types_code UNIQUE (company_id, code),
  CONSTRAINT fk_leave_types_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_leave_types_active ON leave_types (company_id, active);

-- 3. Leave Policies (versioned)
CREATE TABLE IF NOT EXISTS leave_policies (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  leave_type_id uuid NOT NULL,
  version integer DEFAULT 1 NOT NULL,
  effective_from date NOT NULL,
  period_basis text DEFAULT 'calendar' NOT NULL CHECK (period_basis IN ('calendar', 'fiscal', 'anniversary')),
  accrual jsonb DEFAULT '{"frequency": "monthly", "amount": 1.5, "proRata": true, "rounding": 0.5}'::jsonb NOT NULL,
  carry_forward jsonb DEFAULT '{"enabled": false}'::jsonb NOT NULL,
  max_balance numeric(7,3),
  probation_rule jsonb DEFAULT '{"allowDuringProbation": true, "accrueDuringProbation": true}'::jsonb NOT NULL,
  comp_off jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_leave_policies_company_id_id UNIQUE (company_id, id),
  CONSTRAINT uq_leave_policies_version UNIQUE (company_id, leave_type_id, version),
  CONSTRAINT fk_leave_policies_leave_type FOREIGN KEY (company_id, leave_type_id) REFERENCES leave_types(company_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_leave_policies_lookup ON leave_policies (company_id, leave_type_id, effective_from);

-- 4. Leave Policy Assignments
CREATE TABLE IF NOT EXISTS leave_policy_assignments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  scope_type text NOT NULL CHECK (scope_type IN ('company', 'department', 'location', 'employment_type', 'employee')),
  scope_id uuid,
  leave_type_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_leave_policy_assignments_company_id_id UNIQUE (company_id, id),
  CONSTRAINT fk_leave_policy_assignments_leave_type FOREIGN KEY (company_id, leave_type_id) REFERENCES leave_types(company_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_leave_policy_assignments_policy FOREIGN KEY (company_id, policy_id) REFERENCES leave_policies(company_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_leave_policy_assignments_lookup ON leave_policy_assignments (company_id, leave_type_id, scope_type, scope_id);

-- 5. Leave Ledger (strictly append-only)
CREATE TABLE IF NOT EXISTS leave_ledger (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  leave_type_id uuid NOT NULL,
  period_key text NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('opening', 'accrual', 'carry_forward', 'expiry', 'usage', 'reversal', 'adjustment', 'encashment')),
  delta_days numeric(7,3) NOT NULL,
  effective_date date NOT NULL,
  ref_type text,
  ref_id text,
  reason text,
  meta jsonb DEFAULT '{}'::jsonb NOT NULL,
  dedupe_key text,
  created_by uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT uq_leave_ledger_company_id_id UNIQUE (company_id, id),
  CONSTRAINT fk_leave_ledger_employee FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_leave_ledger_leave_type FOREIGN KEY (company_id, leave_type_id) REFERENCES leave_types(company_id, id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_ledger_dedupe ON leave_ledger (company_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leave_ledger_emp_balance ON leave_ledger (company_id, employee_id, leave_type_id, period_key, effective_date);

-- Trigger to reject UPDATE and DELETE on leave_ledger (append-only)
CREATE OR REPLACE FUNCTION trg_leave_ledger_reject_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'leave_ledger is strictly append-only: UPDATE and DELETE operations are prohibited';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_leave_ledger_reject_mutation ON leave_ledger;
CREATE TRIGGER trg_leave_ledger_reject_mutation
BEFORE UPDATE OR DELETE ON leave_ledger
FOR EACH ROW EXECUTE FUNCTION trg_leave_ledger_reject_mutation();

-- 6. Leave Balances (transactional cache)
CREATE TABLE IF NOT EXISTS leave_balances (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  leave_type_id uuid NOT NULL,
  period_key text NOT NULL,
  opening numeric(7,3) DEFAULT 0.000 NOT NULL,
  accrued numeric(7,3) DEFAULT 0.000 NOT NULL,
  used numeric(7,3) DEFAULT 0.000 NOT NULL,
  adjusted numeric(7,3) DEFAULT 0.000 NOT NULL,
  expired numeric(7,3) DEFAULT 0.000 NOT NULL,
  encashed numeric(7,3) DEFAULT 0.000 NOT NULL,
  pending numeric(7,3) DEFAULT 0.000 NOT NULL,
  closing numeric(7,3) DEFAULT 0.000 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_leave_balances_company_id_id UNIQUE (company_id, id),
  CONSTRAINT uq_leave_balances_emp_type_period UNIQUE (company_id, employee_id, leave_type_id, period_key),
  CONSTRAINT fk_leave_balances_employee FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_leave_balances_leave_type FOREIGN KEY (company_id, leave_type_id) REFERENCES leave_types(company_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_leave_balances_emp ON leave_balances (company_id, employee_id);

-- 7. Leave Requests
CREATE TABLE IF NOT EXISTS leave_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  leave_type_id uuid NOT NULL,
  from_date date NOT NULL,
  to_date date NOT NULL,
  from_part text DEFAULT 'full' NOT NULL CHECK (from_part IN ('full', 'first', 'second')),
  to_part text DEFAULT 'full' NOT NULL CHECK (to_part IN ('full', 'first', 'second')),
  hours numeric(4,2),
  days numeric(7,3) NOT NULL,
  reason text NOT NULL,
  document_file_id uuid,
  status text DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'withdrawn')),
  workflow_request_id uuid,
  policy_version integer DEFAULT 1 NOT NULL,
  rule_version integer DEFAULT 1 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_leave_requests_company_id_id UNIQUE (company_id, id),
  CONSTRAINT fk_leave_requests_employee FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_leave_requests_leave_type FOREIGN KEY (company_id, leave_type_id) REFERENCES leave_types(company_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_leave_requests_emp_from ON leave_requests (company_id, employee_id, from_date DESC);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests (company_id, status, created_at DESC);

-- 8. Leave Request Days (with EXCLUDE overlap constraint via btree_gist)
CREATE TABLE IF NOT EXISTS leave_request_days (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  request_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  leave_date date NOT NULL,
  period tstzrange NOT NULL,
  part text DEFAULT 'full' NOT NULL CHECK (part IN ('full', 'first', 'second', 'hours')),
  days numeric(7,3) NOT NULL,
  status text DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'withdrawn')),
  is_paid boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_leave_request_days_company_id_id UNIQUE (company_id, id),
  CONSTRAINT fk_leave_request_days_request FOREIGN KEY (company_id, request_id) REFERENCES leave_requests(company_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_leave_request_days_employee FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE,
  CONSTRAINT ex_leave_request_days_overlap EXCLUDE USING gist (
    company_id WITH =,
    employee_id WITH =,
    period WITH &&
  ) WHERE (status IN ('pending', 'approved'))
);
CREATE INDEX IF NOT EXISTS idx_leave_request_days_date_emp ON leave_request_days (company_id, leave_date, employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_request_days_req ON leave_request_days (company_id, request_id);

-- 9. Holiday Lists
CREATE TABLE IF NOT EXISTS holiday_lists (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  name text NOT NULL,
  year integer NOT NULL,
  location_id uuid,
  is_default boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_holiday_lists_company_id_id UNIQUE (company_id, id),
  CONSTRAINT fk_holiday_lists_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_holiday_lists_year ON holiday_lists (company_id, year);

-- 10. Holidays
CREATE TABLE IF NOT EXISTS holidays (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  list_id uuid NOT NULL,
  date date NOT NULL,
  name text NOT NULL,
  type text DEFAULT 'public' NOT NULL CHECK (type IN ('public', 'optional', 'restricted')),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_holidays_company_id_id UNIQUE (company_id, id),
  CONSTRAINT uq_holidays_list_date UNIQUE (company_id, list_id, date),
  CONSTRAINT fk_holidays_list FOREIGN KEY (company_id, list_id) REFERENCES holiday_lists(company_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays (company_id, date);

-- 11. Holiday Assignments
CREATE TABLE IF NOT EXISTS holiday_assignments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('company', 'location')),
  location_id uuid,
  list_id uuid NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_holiday_assignments_company_id_id UNIQUE (company_id, id),
  CONSTRAINT fk_holiday_assignments_list FOREIGN KEY (company_id, list_id) REFERENCES holiday_lists(company_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_holiday_assignments_lookup ON holiday_assignments (company_id, scope, location_id);

-- 12. Comp-Off Credits
CREATE TABLE IF NOT EXISTS comp_off_credits (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  source_date date NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('weekly_off', 'holiday', 'overtime')),
  minutes_worked integer NOT NULL,
  days_granted numeric(4,2) NOT NULL,
  expires_on date NOT NULL,
  status text DEFAULT 'granted' NOT NULL CHECK (status IN ('granted', 'used', 'expired', 'claimed')),
  ledger_ref uuid,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_comp_off_credits_company_id_id UNIQUE (company_id, id),
  CONSTRAINT uq_comp_off_credits_unique UNIQUE (company_id, employee_id, source_date, source_type),
  CONSTRAINT fk_comp_off_credits_employee FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_comp_off_credits_emp_status ON comp_off_credits (company_id, employee_id, status);

-- 13. Attendance Period Summary (Section 4 & 7)
CREATE TABLE IF NOT EXISTS attendance_period_summary (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  period text NOT NULL,
  present numeric(5,2) DEFAULT 0.00 NOT NULL,
  absent numeric(5,2) DEFAULT 0.00 NOT NULL,
  half_days integer DEFAULT 0 NOT NULL,
  late_count integer DEFAULT 0 NOT NULL,
  early_exit_count integer DEFAULT 0 NOT NULL,
  weekly_off numeric(5,2) DEFAULT 0.00 NOT NULL,
  holidays numeric(5,2) DEFAULT 0.00 NOT NULL,
  leave_days numeric(5,2) DEFAULT 0.00 NOT NULL,
  od_days numeric(5,2) DEFAULT 0.00 NOT NULL,
  wfh_days numeric(5,2) DEFAULT 0.00 NOT NULL,
  worked_minutes integer DEFAULT 0 NOT NULL,
  overtime_minutes integer DEFAULT 0 NOT NULL,
  lop_days numeric(5,2) DEFAULT 0.00 NOT NULL,
  computed_at timestamptz DEFAULT now() NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT uq_att_period_summary_company_id_id UNIQUE (company_id, id),
  CONSTRAINT uq_att_period_summary_emp_period UNIQUE (company_id, employee_id, period),
  CONSTRAINT fk_att_period_summary_employee FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_att_period_summary_period ON attendance_period_summary (company_id, period);

-- 14. Row Level Security (RLS) enforcement
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'leave_types',
    'leave_policies',
    'leave_policy_assignments',
    'leave_ledger',
    'leave_balances',
    'leave_requests',
    'leave_request_days',
    'holiday_lists',
    'holidays',
    'holiday_assignments',
    'comp_off_credits',
    'attendance_period_summary'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%I ON %I;', t, t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation_%I ON %I FOR ALL USING (company_id = NULLIF(current_setting(''app.company_id'', true), '''')::uuid);',
      t, t
    );
  END LOOP;
END;
$$;

-- 15. Role Grants for hrms_app (non-owner application role)
-- leave_ledger is strictly INSERT and SELECT only
GRANT SELECT, INSERT ON leave_ledger TO hrms_app;
REVOKE UPDATE, DELETE ON leave_ledger FROM hrms_app;

-- other tables have standard application CRUD permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON
  leave_types,
  leave_policies,
  leave_policy_assignments,
  leave_balances,
  leave_requests,
  leave_request_days,
  holiday_lists,
  holidays,
  holiday_assignments,
  comp_off_credits,
  attendance_period_summary
TO hrms_app;
