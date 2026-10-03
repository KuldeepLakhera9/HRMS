-- ==============================================================================
-- 0008_sprint_1_2_schema.sql
-- Sprint 1.2 Core Platform Schema:
-- 1. work_locations: address, PostGIS geography center & radius with GIST index
-- 2. counters: atomic sequence generation for emp_code with row locking
-- 3. employees: full master, encrypted sensitive fields, GIN reporting_path, pg_trgm search_key
-- 4. employee_history: effective-dated job changes and timeline
-- 5. files: private object storage tracking with status lifecycle
-- 6. Security definer functions for session family lookup/revocation and counter generation
-- 7. RLS with FORCE ROW LEVEL SECURITY and Composite Foreign Keys
-- 8. Grants and set_updated_at triggers
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Work Locations Table
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  center geography(Point, 4326),
  radius_meters integer,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT work_locations_company_id_id_unique UNIQUE (company_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_locations_company_code
  ON work_locations (company_id, code) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_work_locations_company_active
  ON work_locations (company_id, active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_work_locations_center_gist
  ON work_locations USING GIST (center);
CREATE INDEX IF NOT EXISTS idx_work_locations_created
  ON work_locations (company_id, created_at DESC);

-- ------------------------------------------------------------------------------
-- 2. Counters Table (Atomic row lock sequences for employee codes)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS counters (
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  key text NOT NULL,
  seq bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, key),
  CONSTRAINT counters_company_id_key_unique UNIQUE (company_id, key)
);

-- ------------------------------------------------------------------------------
-- 3. Employees Table
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  emp_code text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  dob date,
  gender text,
  marital_status text,
  email_work citext NOT NULL,
  email_personal citext,
  phone text,
  addresses jsonb NOT NULL DEFAULT '{}'::jsonb,
  emergency_contacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  department_id uuid,
  designation_id uuid,
  grade_id uuid,
  cost_center_id uuid,
  location_id uuid,
  manager_id uuid,
  employment_type text NOT NULL CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'intern')) DEFAULT 'full_time',
  doj date NOT NULL,
  confirmation_date date,
  status text NOT NULL CHECK (status IN ('draft', 'active', 'probation', 'notice', 'terminated')) DEFAULT 'active',
  job_effective_from date NOT NULL DEFAULT CURRENT_DATE,
  reporting_path uuid[] NOT NULL DEFAULT '{}',
  bank_enc text,
  pan_enc text,
  pan_blind_idx text,
  aadhaar_enc text,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_id uuid,
  search_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT employees_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT employees_company_emp_code_unique UNIQUE (company_id, emp_code),
  CONSTRAINT chk_reporting_path_depth CHECK (cardinality(reporting_path) <= 25),
  CONSTRAINT fk_employees_department FOREIGN KEY (company_id, department_id) REFERENCES departments(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_employees_designation FOREIGN KEY (company_id, designation_id) REFERENCES designations(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_employees_grade FOREIGN KEY (company_id, grade_id) REFERENCES grades(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_employees_cost_center FOREIGN KEY (company_id, cost_center_id) REFERENCES cost_centers(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_employees_location FOREIGN KEY (company_id, location_id) REFERENCES work_locations(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_employees_manager FOREIGN KEY (company_id, manager_id) REFERENCES employees(company_id, id) ON DELETE SET NULL,
  CONSTRAINT fk_employees_user FOREIGN KEY (company_id, user_id) REFERENCES users(company_id, id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_pan_blind_idx
  ON employees (company_id, pan_blind_idx) WHERE pan_blind_idx IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_employees_company_status_dept
  ON employees (company_id, status, department_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_employees_company_manager
  ON employees (company_id, manager_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_employees_company_location
  ON employees (company_id, location_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_employees_reporting_path_gin
  ON employees USING GIN (reporting_path);
CREATE INDEX IF NOT EXISTS idx_employees_search_key_trgm
  ON employees USING GIN (search_key gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_employees_keyset
  ON employees (company_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 4. Employee History Table (Effective-dated timeline)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  field text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  effective_from date NOT NULL,
  applied_at timestamptz,
  changed_by uuid NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT employee_history_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT fk_employee_history_employee FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_employee_history_timeline
  ON employee_history (company_id, employee_id, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_employee_history_pending
  ON employee_history (effective_from) WHERE applied_at IS NULL AND deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 5. Files Table (MinIO private bucket tracking)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bucket text NOT NULL,
  object_key text NOT NULL,
  original_name text NOT NULL,
  mime text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text,
  status text NOT NULL CHECK (status IN ('pending', 'clean', 'rejected')) DEFAULT 'pending',
  owner_type text NOT NULL,
  owner_id uuid NOT NULL,
  uploaded_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT files_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT files_bucket_object_unique UNIQUE (bucket, object_key)
);

CREATE INDEX IF NOT EXISTS idx_files_owner
  ON files (company_id, owner_type, owner_id) WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 6. Row Level Security Configuration (Tenant Isolation)
-- ------------------------------------------------------------------------------
ALTER TABLE work_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_locations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS work_locations_isolation_policy ON work_locations;
CREATE POLICY work_locations_isolation_policy ON work_locations
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

ALTER TABLE counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE counters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS counters_isolation_policy ON counters;
CREATE POLICY counters_isolation_policy ON counters
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employees_isolation_policy ON employees;
CREATE POLICY employees_isolation_policy ON employees
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

ALTER TABLE employee_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_history_isolation_policy ON employee_history;
CREATE POLICY employee_history_isolation_policy ON employee_history
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

ALTER TABLE files ENABLE ROW LEVEL SECURITY;
ALTER TABLE files FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS files_isolation_policy ON files;
CREATE POLICY files_isolation_policy ON files
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

-- ------------------------------------------------------------------------------
-- 7. Triggers for Automatic set_updated_at
-- ------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_work_locations_updated_at ON work_locations;
CREATE TRIGGER trg_work_locations_updated_at
  BEFORE UPDATE ON work_locations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_employees_updated_at ON employees;
CREATE TRIGGER trg_employees_updated_at
  BEFORE UPDATE ON employees
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_employee_history_updated_at ON employee_history;
CREATE TRIGGER trg_employee_history_updated_at
  BEFORE UPDATE ON employee_history
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_files_updated_at ON files;
CREATE TRIGGER trg_files_updated_at
  BEFORE UPDATE ON files
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------------------------
-- 8. Security Definer Helper Functions
-- ------------------------------------------------------------------------------

-- Look up session by refresh token hash (used by refresh token rotation)
CREATE OR REPLACE FUNCTION lookup_session_by_refresh_hash(p_refresh_hash text)
RETURNS TABLE (
  id uuid,
  company_id uuid,
  user_id uuid,
  family_id uuid,
  token_hash text,
  refresh_hash text,
  client_type text,
  ip text,
  user_agent text,
  revoked_at timestamptz,
  idle_expires_at timestamptz,
  absolute_expires_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.company_id, s.user_id, s.family_id, s.token_hash, s.refresh_hash,
         s.client_type, s.ip::text, s.user_agent, s.revoked_at,
         s.idle_expires_at, s.absolute_expires_at
  FROM sessions s
  WHERE s.refresh_hash = p_refresh_hash
  LIMIT 1;
$$;

-- Revoke all sessions in a token family (triggered when refresh token reuse is detected)
CREATE OR REPLACE FUNCTION revoke_session_family(p_family_id uuid)
RETURNS TABLE (
  token_hash text,
  session_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE sessions
  SET revoked_at = now()
  WHERE family_id = p_family_id AND revoked_at IS NULL
  RETURNING token_hash, id;
$$;

-- Atomic sequence generator for employee codes
CREATE OR REPLACE FUNCTION next_counter_seq(p_company_id uuid, p_key text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seq bigint;
BEGIN
  INSERT INTO counters (company_id, key, seq, updated_at)
  VALUES (p_company_id, p_key, 1, now())
  ON CONFLICT (company_id, key)
  DO UPDATE SET seq = counters.seq + 1, updated_at = now()
  RETURNING seq INTO v_seq;

  RETURN v_seq;
END;
$$;

-- ------------------------------------------------------------------------------
-- 9. Role Grants to Application and Worker Roles
-- ------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON work_locations TO hrms_app, hrms_worker;
GRANT SELECT, INSERT, UPDATE ON counters TO hrms_app, hrms_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON employees TO hrms_app, hrms_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON employee_history TO hrms_app, hrms_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON files TO hrms_app, hrms_worker;

GRANT EXECUTE ON FUNCTION lookup_session_by_refresh_hash(text) TO hrms_app, hrms_worker;
GRANT EXECUTE ON FUNCTION revoke_session_family(uuid) TO hrms_app, hrms_worker;
GRANT EXECUTE ON FUNCTION next_counter_seq(uuid, text) TO hrms_app, hrms_worker;
