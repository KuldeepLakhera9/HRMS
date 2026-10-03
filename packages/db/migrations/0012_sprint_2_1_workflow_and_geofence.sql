-- ==============================================================================
-- 0012_sprint_2_1_workflow_and_geofence.sql
-- Sprint 2.1: Work Locations PostGIS extensions, Employee Locations,
-- Workflow Engine, and Attendance Policies & Assignments.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Extend work_locations with PostGIS Polygon, BSSIDs, QR secret, timezone
-- ------------------------------------------------------------------------------
ALTER TABLE work_locations
  ADD COLUMN IF NOT EXISTS geofence_type text NOT NULL DEFAULT 'radius' CHECK (geofence_type IN ('radius', 'polygon')),
  ADD COLUMN IF NOT EXISTS polygon geography(Polygon, 4326),
  ADD COLUMN IF NOT EXISTS wifi_bssids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS qr_secret text,
  ADD COLUMN IF NOT EXISTS geofence_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Kolkata';

CREATE INDEX IF NOT EXISTS idx_work_locations_center ON work_locations USING GIST (center);
CREATE INDEX IF NOT EXISTS idx_work_locations_polygon ON work_locations USING GIST (polygon);

-- ------------------------------------------------------------------------------
-- 2. employee_locations: Employee location assignments with validity dates
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_locations (
  id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id),
  employee_id uuid NOT NULL,
  location_id uuid NOT NULL,
  assignment_type text NOT NULL CHECK (assignment_type IN ('fixed', 'flexible', 'remote', 'field')),
  valid_from date NOT NULL,
  valid_to date,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT pk_employee_locations PRIMARY KEY (id),
  CONSTRAINT uq_employee_locations_company_id UNIQUE (company_id, id),
  CONSTRAINT fk_emp_loc_employee FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id),
  CONSTRAINT fk_emp_loc_location FOREIGN KEY (company_id, location_id) REFERENCES work_locations(company_id, id)
);

ALTER TABLE employee_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_locations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS employee_locations_tenant_isolation ON employee_locations;
CREATE POLICY employee_locations_tenant_isolation ON employee_locations
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

CREATE INDEX IF NOT EXISTS idx_emp_locations_lookup
  ON employee_locations (company_id, employee_id, valid_from, valid_to)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 3. workflow_definitions: Versioned data-driven workflow configuration
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id),
  code text NOT NULL,
  name text NOT NULL,
  entity_type text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  steps jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT pk_workflow_definitions PRIMARY KEY (id),
  CONSTRAINT uq_workflow_definitions_company_id UNIQUE (company_id, id),
  CONSTRAINT uq_workflow_definitions_version UNIQUE (company_id, code, version)
);

ALTER TABLE workflow_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_definitions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflow_definitions_tenant_isolation ON workflow_definitions;
CREATE POLICY workflow_definitions_tenant_isolation ON workflow_definitions
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

CREATE INDEX IF NOT EXISTS idx_wf_definitions_lookup
  ON workflow_definitions (company_id, entity_type, is_active)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 4. workflow_requests: Workflow execution instances (pinned definition version)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_requests (
  id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id),
  definition_id uuid NOT NULL,
  definition_version integer NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  requester_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn', 'cancelled')),
  current_step_index integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}',
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT pk_workflow_requests PRIMARY KEY (id),
  CONSTRAINT uq_workflow_requests_company_id UNIQUE (company_id, id),
  CONSTRAINT fk_wf_req_definition FOREIGN KEY (company_id, definition_id) REFERENCES workflow_definitions(company_id, id),
  CONSTRAINT fk_wf_req_requester FOREIGN KEY (company_id, requester_id) REFERENCES employees(company_id, id)
);

ALTER TABLE workflow_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflow_requests_tenant_isolation ON workflow_requests;
CREATE POLICY workflow_requests_tenant_isolation ON workflow_requests
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

CREATE INDEX IF NOT EXISTS idx_wf_requests_inbox
  ON workflow_requests (company_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_wf_requests_entity
  ON workflow_requests (company_id, entity_type, entity_id)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 5. workflow_steps: Steps within an active workflow instance
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_steps (
  id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id),
  request_id uuid NOT NULL,
  step_index integer NOT NULL,
  name text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('any', 'all')),
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'skipped')),
  due_at timestamptz,
  escalated_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT pk_workflow_steps PRIMARY KEY (id),
  CONSTRAINT uq_workflow_steps_company_id UNIQUE (company_id, id),
  CONSTRAINT fk_wf_step_request FOREIGN KEY (company_id, request_id) REFERENCES workflow_requests(company_id, id)
);

ALTER TABLE workflow_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_steps FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflow_steps_tenant_isolation ON workflow_steps;
CREATE POLICY workflow_steps_tenant_isolation ON workflow_steps
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

CREATE INDEX IF NOT EXISTS idx_wf_steps_due
  ON workflow_steps (company_id, status, due_at)
  WHERE status = 'pending';

-- ------------------------------------------------------------------------------
-- 6. workflow_assignees: Inbox index table for direct assignee lookups
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_assignees (
  id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id),
  request_id uuid NOT NULL,
  step_id uuid NOT NULL,
  assignee_id uuid NOT NULL,
  original_assignee_id uuid,
  is_delegated boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('pending', 'acted', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT pk_workflow_assignees PRIMARY KEY (id),
  CONSTRAINT uq_workflow_assignees_company_id UNIQUE (company_id, id),
  CONSTRAINT fk_wf_assignee_request FOREIGN KEY (company_id, request_id) REFERENCES workflow_requests(company_id, id),
  CONSTRAINT fk_wf_assignee_step FOREIGN KEY (company_id, step_id) REFERENCES workflow_steps(company_id, id),
  CONSTRAINT fk_wf_assignee_emp FOREIGN KEY (company_id, assignee_id) REFERENCES employees(company_id, id)
);

ALTER TABLE workflow_assignees ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_assignees FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflow_assignees_tenant_isolation ON workflow_assignees;
CREATE POLICY workflow_assignees_tenant_isolation ON workflow_assignees
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

CREATE INDEX IF NOT EXISTS idx_wf_assignees_inbox
  ON workflow_assignees (company_id, assignee_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 7. workflow_actions: Immutable append-only audit trail of approval actions
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_actions (
  id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id),
  request_id uuid NOT NULL,
  step_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('approve', 'reject', 'delegate', 'withdraw')),
  comments text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  created_by uuid NOT NULL,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT pk_workflow_actions PRIMARY KEY (id),
  CONSTRAINT uq_workflow_actions_company_id UNIQUE (company_id, id),
  CONSTRAINT fk_wf_action_request FOREIGN KEY (company_id, request_id) REFERENCES workflow_requests(company_id, id),
  CONSTRAINT fk_wf_action_step FOREIGN KEY (company_id, step_id) REFERENCES workflow_steps(company_id, id),
  CONSTRAINT fk_wf_action_actor FOREIGN KEY (company_id, actor_id) REFERENCES employees(company_id, id)
);

ALTER TABLE workflow_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_actions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflow_actions_tenant_isolation ON workflow_actions;
CREATE POLICY workflow_actions_tenant_isolation ON workflow_actions
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

DROP TRIGGER IF EXISTS trg_workflow_actions_append_only ON workflow_actions;
CREATE TRIGGER trg_workflow_actions_append_only
  BEFORE UPDATE OR DELETE ON workflow_actions
  FOR EACH ROW EXECUTE FUNCTION reject_update_delete();

-- ------------------------------------------------------------------------------
-- 8. workflow_delegations: Temporary or scheduled approval delegations
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_delegations (
  id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id),
  delegator_id uuid NOT NULL,
  delegatee_id uuid NOT NULL,
  entity_type text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT pk_workflow_delegations PRIMARY KEY (id),
  CONSTRAINT uq_workflow_delegations_company_id UNIQUE (company_id, id),
  CONSTRAINT fk_wf_del_delegator FOREIGN KEY (company_id, delegator_id) REFERENCES employees(company_id, id),
  CONSTRAINT fk_wf_del_delegatee FOREIGN KEY (company_id, delegatee_id) REFERENCES employees(company_id, id)
);

ALTER TABLE workflow_delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_delegations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workflow_delegations_tenant_isolation ON workflow_delegations;
CREATE POLICY workflow_delegations_tenant_isolation ON workflow_delegations
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

CREATE INDEX IF NOT EXISTS idx_wf_delegations_lookup
  ON workflow_delegations (company_id, delegator_id, is_active, starts_at, ends_at)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 9. attendance_policies & attendance_policy_assignments
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_policies (
  id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id),
  code text NOT NULL,
  name text NOT NULL,
  description text,
  geofence_mode text NOT NULL DEFAULT 'strict' CHECK (geofence_mode IN ('strict', 'soft', 'off')),
  allow_selfie boolean NOT NULL DEFAULT false,
  require_selfie boolean NOT NULL DEFAULT false,
  max_gps_accuracy_meters integer NOT NULL DEFAULT 50,
  allowed_sources text[] NOT NULL DEFAULT '{"mobile", "web"}',
  grace_minutes integer NOT NULL DEFAULT 15,
  half_day_minutes integer NOT NULL DEFAULT 240,
  full_day_minutes integer NOT NULL DEFAULT 480,
  auto_punch_out_hours numeric(4,1) NOT NULL DEFAULT 12.0,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT pk_attendance_policies PRIMARY KEY (id),
  CONSTRAINT uq_attendance_policies_company_id UNIQUE (company_id, id),
  CONSTRAINT uq_attendance_policies_code UNIQUE (company_id, code)
);

ALTER TABLE attendance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_policies FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attendance_policies_tenant_isolation ON attendance_policies;
CREATE POLICY attendance_policies_tenant_isolation ON attendance_policies
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

CREATE TABLE IF NOT EXISTS attendance_policy_assignments (
  id uuid NOT NULL,
  company_id uuid NOT NULL REFERENCES companies(id),
  policy_id uuid NOT NULL,
  priority integer NOT NULL, -- 1=employee, 2=department, 3=location, 4=company
  target_type text NOT NULL CHECK (target_type IN ('employee', 'department', 'location', 'company')),
  target_id uuid,
  valid_from date NOT NULL,
  valid_to date,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT pk_attendance_policy_assignments PRIMARY KEY (id),
  CONSTRAINT uq_att_policy_assign_company_id UNIQUE (company_id, id),
  CONSTRAINT fk_att_policy_assign_policy FOREIGN KEY (company_id, policy_id) REFERENCES attendance_policies(company_id, id)
);

ALTER TABLE attendance_policy_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_policy_assignments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attendance_policy_assignments_tenant_isolation ON attendance_policy_assignments;
CREATE POLICY attendance_policy_assignments_tenant_isolation ON attendance_policy_assignments
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

CREATE INDEX IF NOT EXISTS idx_att_policy_assignments_lookup
  ON attendance_policy_assignments (company_id, target_type, target_id, priority)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 10. Update updated_at Triggers
-- ------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_employee_locations_updated_at ON employee_locations;
CREATE TRIGGER trg_employee_locations_updated_at
  BEFORE UPDATE ON employee_locations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_workflow_definitions_updated_at ON workflow_definitions;
CREATE TRIGGER trg_workflow_definitions_updated_at
  BEFORE UPDATE ON workflow_definitions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_workflow_requests_updated_at ON workflow_requests;
CREATE TRIGGER trg_workflow_requests_updated_at
  BEFORE UPDATE ON workflow_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_workflow_steps_updated_at ON workflow_steps;
CREATE TRIGGER trg_workflow_steps_updated_at
  BEFORE UPDATE ON workflow_steps
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_workflow_assignees_updated_at ON workflow_assignees;
CREATE TRIGGER trg_workflow_assignees_updated_at
  BEFORE UPDATE ON workflow_assignees
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_workflow_delegations_updated_at ON workflow_delegations;
CREATE TRIGGER trg_workflow_delegations_updated_at
  BEFORE UPDATE ON workflow_delegations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_attendance_policies_updated_at ON attendance_policies;
CREATE TRIGGER trg_attendance_policies_updated_at
  BEFORE UPDATE ON attendance_policies
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_att_policy_assign_updated_at ON attendance_policy_assignments;
CREATE TRIGGER trg_att_policy_assign_updated_at
  BEFORE UPDATE ON attendance_policy_assignments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
