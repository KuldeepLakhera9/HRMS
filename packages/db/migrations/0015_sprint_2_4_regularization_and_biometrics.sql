-- Migration: 0015_sprint_2_4_regularization_and_biometrics.sql
-- Description: Attendance regularization, biometric devices, biometric quarantine, and RLS

-- ------------------------------------------------------------------------------
-- 1. attendance_regularization_requests: Employee requests for missed/adjusted punches
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_regularization_requests (
  id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  date date NOT NULL,
  request_type text NOT NULL CHECK (request_type IN ('punch_missing', 'in_time_change', 'out_time_change', 'on_duty', 'work_from_home')),
  in_time time,
  out_time time,
  reason text NOT NULL,
  workflow_request_id uuid,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')) DEFAULT 'pending',
  synthetic_in_punch_id uuid,
  synthetic_out_punch_id uuid,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT pk_attendance_regularization_requests PRIMARY KEY (id),
  CONSTRAINT uq_attendance_reg_company_id UNIQUE (company_id, id),
  CONSTRAINT fk_attendance_reg_employee FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE
);

ALTER TABLE attendance_regularization_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_regularization_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attendance_reg_tenant_isolation ON attendance_regularization_requests;
CREATE POLICY attendance_reg_tenant_isolation ON attendance_regularization_requests
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = current_setting('app.company_id', true)::uuid)
  WITH CHECK (company_id = current_setting('app.company_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_attendance_reg_emp_date
  ON attendance_regularization_requests (company_id, employee_id, date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_reg_status
  ON attendance_regularization_requests (company_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_reg_wf_id
  ON attendance_regularization_requests (company_id, workflow_request_id)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 2. biometric_devices: On-premise biometric hardware registry
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS biometric_devices (
  id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  name text NOT NULL,
  ip_cidr text NOT NULL,
  hmac_secret text NOT NULL,
  location_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT pk_biometric_devices PRIMARY KEY (id),
  CONSTRAINT uq_biometric_devices UNIQUE (company_id, id),
  CONSTRAINT uq_biometric_devices_code UNIQUE (company_id, device_id),
  CONSTRAINT fk_biometric_devices_location FOREIGN KEY (company_id, location_id) REFERENCES work_locations(company_id, id)
);

ALTER TABLE biometric_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE biometric_devices FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS biometric_devices_tenant_isolation ON biometric_devices;
CREATE POLICY biometric_devices_tenant_isolation ON biometric_devices
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = current_setting('app.company_id', true)::uuid)
  WITH CHECK (company_id = current_setting('app.company_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_biometric_devices_lookup
  ON biometric_devices (company_id, device_id)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 3. biometric_quarantine: Unmapped punches for review/reconciliation
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS biometric_quarantine (
  id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  biometric_user_id text NOT NULL,
  punch_time timestamptz NOT NULL,
  punch_type text NOT NULL CHECK (punch_type IN ('in', 'out', 'auto')),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_reason text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  resolved_employee_id uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT pk_biometric_quarantine PRIMARY KEY (id),
  CONSTRAINT uq_biometric_quarantine UNIQUE (company_id, id)
);

ALTER TABLE biometric_quarantine ENABLE ROW LEVEL SECURITY;
ALTER TABLE biometric_quarantine FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS biometric_quarantine_tenant_isolation ON biometric_quarantine;
CREATE POLICY biometric_quarantine_tenant_isolation ON biometric_quarantine
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = current_setting('app.company_id', true)::uuid)
  WITH CHECK (company_id = current_setting('app.company_id', true)::uuid);

CREATE INDEX IF NOT EXISTS idx_biometric_quarantine_lookup
  ON biometric_quarantine (company_id, resolved, created_at DESC)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 4. Extend employees table with biometric_id
-- ------------------------------------------------------------------------------
ALTER TABLE employees ADD COLUMN IF NOT EXISTS biometric_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_biometric_id
  ON employees (company_id, biometric_id)
  WHERE deleted_at IS NULL AND biometric_id IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 5. Extend attendance_punches: is_synthetic column and regularization source
-- ------------------------------------------------------------------------------
ALTER TABLE attendance_punches ADD COLUMN IF NOT EXISTS is_synthetic boolean NOT NULL DEFAULT false;

-- Drop and recreate check constraint to include 'regularization' in source enum
ALTER TABLE attendance_punches DROP CONSTRAINT IF EXISTS attendance_punches_source_check;
ALTER TABLE attendance_punches ADD CONSTRAINT attendance_punches_source_check
  CHECK (source IN ('mobile', 'web', 'biometric', 'qr', 'regularization'));

-- ------------------------------------------------------------------------------
-- 6. Table Grants to hrms_app and hrms_worker
-- ------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON attendance_regularization_requests TO hrms_app, hrms_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON biometric_devices TO hrms_app, hrms_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON biometric_quarantine TO hrms_app, hrms_worker;
