-- ==============================================================================
-- 0013_sprint_2_2_punches_shifts_presence.sql
-- Sprint 2.2: Shifts, Rosters, Partitioned Attendance Punches,
-- Punch Reviews, Real-time Presence, and Consolidated Views.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. shifts: Shift Definitions with Night-Shift Support
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shifts (
  id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  crosses_midnight boolean NOT NULL DEFAULT false,
  grace_minutes integer NOT NULL DEFAULT 15,
  break_minutes integer NOT NULL DEFAULT 60,
  work_hours numeric(4,2) NOT NULL DEFAULT 8.00,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT pk_shifts PRIMARY KEY (id),
  CONSTRAINT uq_shifts_company_id UNIQUE (company_id, id),
  CONSTRAINT uq_shifts_code UNIQUE (company_id, code)
);

ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shifts_tenant_isolation ON shifts;
CREATE POLICY shifts_tenant_isolation ON shifts
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

DROP POLICY IF EXISTS shifts_owner_policy ON shifts;
CREATE POLICY shifts_owner_policy ON shifts
  FOR ALL TO hrms_owner
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_shifts_company ON shifts (company_id) WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 2. rosters: Shift and Weekly Off Assignments
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rosters (
  id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  work_date date NOT NULL,
  is_weekly_off boolean NOT NULL DEFAULT false,
  is_holiday boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT pk_rosters PRIMARY KEY (id),
  CONSTRAINT uq_rosters_company_id UNIQUE (company_id, id),
  CONSTRAINT uq_rosters_employee_date UNIQUE (company_id, employee_id, work_date),
  CONSTRAINT fk_rosters_employee FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_rosters_shift FOREIGN KEY (company_id, shift_id) REFERENCES shifts(company_id, id) ON DELETE RESTRICT
);

ALTER TABLE rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE rosters FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rosters_tenant_isolation ON rosters;
CREATE POLICY rosters_tenant_isolation ON rosters
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

DROP POLICY IF EXISTS rosters_owner_policy ON rosters;
CREATE POLICY rosters_owner_policy ON rosters
  FOR ALL TO hrms_owner
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_rosters_lookup
  ON rosters (company_id, employee_id, work_date)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 3. attendance_punches: Monthly Partitioned Append-Only Punch Ledger
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_punches (
  id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  punch_time timestamptz NOT NULL,
  punch_type text NOT NULL CHECK (punch_type IN ('in', 'out', 'auto_out')),
  source text NOT NULL CHECK (source IN ('mobile', 'web', 'biometric', 'qr')),
  work_date date NOT NULL,
  shift_id uuid,
  location_id uuid,
  location_coords geography(Point, 4326),
  gps_accuracy numeric(6,2),
  is_inside_geofence boolean NOT NULL DEFAULT true,
  distance_meters numeric(8,2),
  selfie_file_id uuid,
  device_id text,
  device_model text,
  is_mock_location boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'flagged', 'soft_pending', 'rejected')),
  reason_code text NOT NULL DEFAULT 'PUNCH_SUCCESS',
  flag_reasons text[] NOT NULL DEFAULT '{}',
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_attendance_punches PRIMARY KEY (company_id, id, punch_time)
) PARTITION BY RANGE (punch_time);

ALTER TABLE attendance_punches ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_punches FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attendance_punches_tenant_isolation ON attendance_punches;
CREATE POLICY attendance_punches_tenant_isolation ON attendance_punches
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

DROP POLICY IF EXISTS attendance_punches_owner_policy ON attendance_punches;
CREATE POLICY attendance_punches_owner_policy ON attendance_punches
  FOR ALL TO hrms_owner
  USING (true)
  WITH CHECK (true);

-- Partitioned Indexes
CREATE INDEX IF NOT EXISTS idx_attendance_punches_emp
  ON attendance_punches (company_id, employee_id, punch_time DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_punches_work_date
  ON attendance_punches (company_id, work_date);

CREATE INDEX IF NOT EXISTS idx_attendance_punches_coords
  ON attendance_punches USING GIST (location_coords);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_punches_idempotency
  ON attendance_punches (company_id, idempotency_key, punch_time)
  WHERE idempotency_key IS NOT NULL;

-- Append-Only Security Trigger on Master Table
DROP TRIGGER IF EXISTS trg_reject_punches_mutations ON attendance_punches;
CREATE TRIGGER trg_reject_punches_mutations
  BEFORE UPDATE OR DELETE ON attendance_punches
  FOR EACH STATEMENT
  EXECUTE FUNCTION reject_update_delete();

-- Role Privileges: Append-only defense-in-depth
GRANT SELECT, INSERT ON attendance_punches TO hrms_app, hrms_worker;
REVOKE UPDATE, DELETE ON attendance_punches FROM hrms_app, hrms_worker;

-- ------------------------------------------------------------------------------
-- 4. Dynamic Partition Maintenance Function for attendance_punches
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_attendance_punches_partition(p_year int, p_month int)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_partition_name text;
  v_start_date timestamptz;
  v_end_date timestamptz;
  v_sql text;
BEGIN
  v_partition_name := format('attendance_punches_%s_%s', p_year, to_char(p_month, 'FM09'));
  v_start_date := make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'UTC');
  v_end_date := v_start_date + interval '1 month';

  v_sql := format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF attendance_punches FOR VALUES FROM (%L) TO (%L);',
    v_partition_name,
    v_start_date,
    v_end_date
  );

  EXECUTE v_sql;

  -- Ensure proper permissions on newly created partition
  EXECUTE format('GRANT SELECT, INSERT ON %I TO hrms_app, hrms_worker;', v_partition_name);
  EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM hrms_app, hrms_worker;', v_partition_name);

  RETURN v_partition_name;
END;
$$;

REVOKE ALL ON FUNCTION create_attendance_punches_partition(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_attendance_punches_partition(int, int) TO hrms_owner, hrms_worker;

-- Pre-create partitions for current and upcoming months
SELECT create_attendance_punches_partition(2026, 9);
SELECT create_attendance_punches_partition(2026, 10);
SELECT create_attendance_punches_partition(2026, 11);
SELECT create_attendance_punches_partition(2026, 12);
SELECT create_attendance_punches_partition(2027, 1);
SELECT create_attendance_punches_partition(2027, 2);

-- ------------------------------------------------------------------------------
-- 5. attendance_punch_reviews: Reviews for Soft-Policy Outside-Geofence Punches
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_punch_reviews (
  id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  punch_id uuid NOT NULL,
  punch_time timestamptz NOT NULL,
  workflow_request_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewer_id uuid,
  review_comments text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT pk_attendance_punch_reviews PRIMARY KEY (id),
  CONSTRAINT uq_punch_reviews_company_id UNIQUE (company_id, id),
  CONSTRAINT fk_punch_reviews_workflow FOREIGN KEY (company_id, workflow_request_id) REFERENCES workflow_requests(company_id, id) ON DELETE CASCADE
);

ALTER TABLE attendance_punch_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_punch_reviews FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS punch_reviews_tenant_isolation ON attendance_punch_reviews;
CREATE POLICY punch_reviews_tenant_isolation ON attendance_punch_reviews
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

DROP POLICY IF EXISTS punch_reviews_owner_policy ON attendance_punch_reviews;
CREATE POLICY punch_reviews_owner_policy ON attendance_punch_reviews
  FOR ALL TO hrms_owner
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_punch_reviews_lookup
  ON attendance_punch_reviews (company_id, punch_id, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_punch_reviews_wf
  ON attendance_punch_reviews (company_id, workflow_request_id)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 6. attendance_presence: Real-Time Employee Presence Status
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_presence (
  id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('in', 'out')),
  last_punch_id uuid NOT NULL,
  last_punch_time timestamptz NOT NULL,
  location_id uuid,
  shift_date date NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_attendance_presence PRIMARY KEY (id),
  CONSTRAINT uq_attendance_presence_company_id UNIQUE (company_id, id),
  CONSTRAINT uq_attendance_presence_employee UNIQUE (company_id, employee_id),
  CONSTRAINT fk_attendance_presence_employee FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE
);

ALTER TABLE attendance_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_presence FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attendance_presence_tenant_isolation ON attendance_presence;
CREATE POLICY attendance_presence_tenant_isolation ON attendance_presence
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

DROP POLICY IF EXISTS attendance_presence_owner_policy ON attendance_presence;
CREATE POLICY attendance_presence_owner_policy ON attendance_presence
  FOR ALL TO hrms_owner
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_attendance_presence_status
  ON attendance_presence (company_id, status, shift_date);

-- ------------------------------------------------------------------------------
-- 7. v_effective_punches: Consolidated View Joining Punches with Reviews
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_effective_punches AS
SELECT
  p.id,
  p.company_id,
  p.employee_id,
  p.punch_time,
  p.punch_type,
  p.source,
  p.work_date,
  p.shift_id,
  p.location_id,
  p.location_coords,
  p.gps_accuracy,
  p.is_inside_geofence,
  p.distance_meters,
  p.selfie_file_id,
  p.device_id,
  p.device_model,
  p.is_mock_location,
  p.status as raw_status,
  COALESCE(r.status, p.status) as effective_status,
  p.reason_code,
  p.flag_reasons,
  p.idempotency_key,
  p.created_at,
  r.id as review_id,
  r.workflow_request_id,
  r.reviewer_id,
  r.review_comments,
  r.reviewed_at
FROM attendance_punches p
LEFT JOIN attendance_punch_reviews r
  ON r.company_id = p.company_id
 AND r.punch_id = p.id
 AND r.deleted_at IS NULL;

-- Permissions on all tables for app & worker
GRANT SELECT, INSERT, UPDATE, DELETE ON shifts TO hrms_app, hrms_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON rosters TO hrms_app, hrms_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON attendance_punch_reviews TO hrms_app, hrms_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON attendance_presence TO hrms_app, hrms_worker;
GRANT SELECT ON v_effective_punches TO hrms_app, hrms_worker;
