-- ==============================================================================
-- 0014_sprint_2_3_devices_days_locks.sql
-- Sprint 2.3: Employee Devices (1 Active Device per Employee),
-- Attendance Days (Daily Ledger with Rule Version), and Attendance Period Locks.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. employee_devices: Mobile Device Binding & Attestation Status
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_devices (
  id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  device_id text NOT NULL,
  device_model text NOT NULL,
  os_name text NOT NULL,
  os_version text NOT NULL,
  app_version text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending_approval', 'revoked')),
  last_attested_at timestamptz,
  attestation_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT pk_employee_devices PRIMARY KEY (id),
  CONSTRAINT uq_employee_devices_company_id UNIQUE (company_id, id),
  CONSTRAINT fk_employee_devices_employee FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE
);

ALTER TABLE employee_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_devices FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_devices_tenant_isolation ON employee_devices;
CREATE POLICY employee_devices_tenant_isolation ON employee_devices
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

DROP POLICY IF EXISTS employee_devices_owner_policy ON employee_devices;
CREATE POLICY employee_devices_owner_policy ON employee_devices
  FOR ALL TO hrms_owner
  USING (true)
  WITH CHECK (true);

-- Enforce exactly one active device per employee
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_devices_active_emp
  ON employee_devices (company_id, employee_id)
  WHERE status = 'active' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_employee_devices_lookup
  ON employee_devices (company_id, employee_id, device_id)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 2. attendance_days: Calculated Daily Attendance Ledger
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_days (
  id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  work_date date NOT NULL,
  shift_id uuid,
  first_in timestamptz,
  last_out timestamptz,
  punch_count integer NOT NULL DEFAULT 0,
  total_work_minutes integer NOT NULL DEFAULT 0,
  effective_minutes integer NOT NULL DEFAULT 0,
  late_in_minutes integer NOT NULL DEFAULT 0,
  early_out_minutes integer NOT NULL DEFAULT 0,
  overtime_minutes integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'absent' CHECK (status IN ('present', 'absent', 'half_day', 'on_leave', 'holiday', 'weekly_off', 'missing_punch')),
  is_regularized boolean NOT NULL DEFAULT false,
  is_locked boolean NOT NULL DEFAULT false,
  rule_version integer NOT NULL DEFAULT 1,
  source_hash text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT pk_attendance_days PRIMARY KEY (id),
  CONSTRAINT uq_attendance_days_company_id UNIQUE (company_id, id),
  CONSTRAINT uq_attendance_days_emp_date UNIQUE (company_id, employee_id, work_date),
  CONSTRAINT fk_attendance_days_employee FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_attendance_days_shift FOREIGN KEY (company_id, shift_id) REFERENCES shifts(company_id, id) ON DELETE SET NULL
);

ALTER TABLE attendance_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_days FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attendance_days_tenant_isolation ON attendance_days;
CREATE POLICY attendance_days_tenant_isolation ON attendance_days
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

DROP POLICY IF EXISTS attendance_days_owner_policy ON attendance_days;
CREATE POLICY attendance_days_owner_policy ON attendance_days
  FOR ALL TO hrms_owner
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_attendance_days_company_date
  ON attendance_days (company_id, work_date, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_days_emp_date
  ON attendance_days (company_id, employee_id, work_date)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 3. attendance_period_locks: Monthly/Period Attendance Locking
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_period_locks (
  id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  is_locked boolean NOT NULL DEFAULT true,
  locked_by uuid NOT NULL,
  locked_at timestamptz NOT NULL DEFAULT NOW(),
  unlocked_by uuid,
  unlocked_at timestamptz,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT pk_attendance_period_locks PRIMARY KEY (id),
  CONSTRAINT uq_attendance_period_locks_company_id UNIQUE (company_id, id),
  CONSTRAINT uq_attendance_period_locks_period UNIQUE (company_id, period_start, period_end),
  CONSTRAINT fk_attendance_period_locks_locked_by FOREIGN KEY (company_id, locked_by) REFERENCES users(company_id, id) ON DELETE RESTRICT
);

ALTER TABLE attendance_period_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_period_locks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attendance_period_locks_tenant_isolation ON attendance_period_locks;
CREATE POLICY attendance_period_locks_tenant_isolation ON attendance_period_locks
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

DROP POLICY IF EXISTS attendance_period_locks_owner_policy ON attendance_period_locks;
CREATE POLICY attendance_period_locks_owner_policy ON attendance_period_locks
  FOR ALL TO hrms_owner
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_attendance_period_locks_lookup
  ON attendance_period_locks (company_id, period_start, period_end)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 4. Grants on new tables
-- ------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON employee_devices TO hrms_app, hrms_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON attendance_days TO hrms_app, hrms_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON attendance_period_locks TO hrms_app, hrms_worker;
