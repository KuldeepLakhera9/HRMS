-- ==============================================================================
-- 0003_sprint_1_1_core_schema.sql
-- Sprint 1.1 Core Platform Schema:
-- 1. Identity & Auth: users, roles, role_permissions, user_roles, sessions, auth_tokens, mfa_recovery_codes
-- 2. Audit & Outbox: audit_logs (monthly partitioned, append-only), outbox_events
-- 3. Organization Master: departments (tree), designations, grades, cost_centers
-- 4. RLS with FORCE ROW LEVEL SECURITY and Composite Foreign Keys on all tenant tables
-- 5. Role Grants & Trigger Attachments
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Identity & Roles Tables
-- ------------------------------------------------------------------------------

-- Users Table
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email citext NOT NULL,
  password_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('invited', 'active', 'locked', 'disabled')) DEFAULT 'invited',
  mfa_enabled boolean NOT NULL DEFAULT false,
  mfa_secret_enc text,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  perm_version integer NOT NULL DEFAULT 1,
  employee_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT users_company_id_id_unique UNIQUE (company_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_company_email ON users (company_id, email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_company_status ON users (company_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_locked_until ON users (locked_until) WHERE locked_until IS NOT NULL;

-- Roles Table
CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  requires_mfa boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT roles_company_id_id_unique UNIQUE (company_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_company_name ON roles (company_id, name) WHERE deleted_at IS NULL;

-- Role Permissions Table (Composite FK to roles)
CREATE TABLE IF NOT EXISTS role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  role_id uuid NOT NULL,
  permission_key text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('self', 'team', 'department', 'location', 'company')) DEFAULT 'company',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT role_permissions_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT fk_role_permissions_role FOREIGN KEY (company_id, role_id) REFERENCES roles(company_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_role_permissions_role_key ON role_permissions (company_id, role_id, permission_key);

-- User Roles Table (Composite FKs to users and roles)
CREATE TABLE IF NOT EXISTS user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT user_roles_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT fk_user_roles_user FOREIGN KEY (company_id, user_id) REFERENCES users(company_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_user_roles_role FOREIGN KEY (company_id, role_id) REFERENCES roles(company_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_roles_unique ON user_roles (company_id, user_id, role_id);

-- ------------------------------------------------------------------------------
-- 2. Sessions, Auth Tokens, and MFA Recovery Tables
-- ------------------------------------------------------------------------------

-- Sessions Table
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  refresh_hash text UNIQUE,
  family_id uuid NOT NULL,
  client_type text NOT NULL CHECK (client_type IN ('web', 'mobile', 'api')) DEFAULT 'web',
  ip inet,
  user_agent text,
  device_label text,
  mfa_verified_at timestamptz,
  step_up_until timestamptz,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT sessions_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (company_id, user_id) REFERENCES users(company_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_active ON sessions (company_id, user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_absolute_expiry ON sessions (absolute_expires_at);

-- Auth Tokens (Single-use Invite and Password Reset tokens)
CREATE TABLE IF NOT EXISTS auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('invite', 'reset')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT auth_tokens_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT fk_auth_tokens_user FOREIGN KEY (company_id, user_id) REFERENCES users(company_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_lookup ON auth_tokens (token_hash, type) WHERE used_at IS NULL;

-- MFA Recovery Codes
CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT mfa_recovery_codes_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT fk_mfa_recovery_user FOREIGN KEY (company_id, user_id) REFERENCES users(company_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_mfa_recovery_lookup ON mfa_recovery_codes (company_id, user_id) WHERE used_at IS NULL;

-- ------------------------------------------------------------------------------
-- 3. Partitioned Append-Only Audit Trail & Outbox Events
-- ------------------------------------------------------------------------------

-- Audit Logs Table (Partitioned by RANGE on ts)
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ts timestamptz NOT NULL DEFAULT now(),
  company_id uuid NOT NULL,
  actor_id uuid,
  actor_role text,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  before jsonb,
  after jsonb,
  ip inet,
  user_agent text,
  request_id text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id, ts)
) PARTITION BY RANGE (ts);

-- Pre-create initial monthly partitions for 2026/2027
CREATE TABLE IF NOT EXISTS audit_logs_2026_09 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS audit_logs_2026_10 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS audit_logs_2026_11 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS audit_logs_2026_12 PARTITION OF audit_logs
  FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS audit_logs_2027_01 PARTITION OF audit_logs
  FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2027-02-01 00:00:00+00');

-- Audit Log Indexes (defined on parent table; automatically propagated to partitions)
CREATE INDEX IF NOT EXISTS idx_audit_logs_company_entity ON audit_logs (company_id, entity, entity_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_company_actor ON audit_logs (company_id, actor_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_company_action ON audit_logs (company_id, action, ts DESC);

-- Attach append-only trigger to parent audit_logs table
DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON audit_logs;
CREATE TRIGGER trg_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_update_delete();

-- Outbox Events Table
CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  aggregate text NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_outbox_unprocessed ON outbox_events (created_at) WHERE processed_at IS NULL;

-- ------------------------------------------------------------------------------
-- 4. Organization Structure Master Tables
-- ------------------------------------------------------------------------------

-- Departments Table (Self-referential composite FK for tree structure)
CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  parent_id uuid,
  head_employee_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT departments_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT fk_departments_parent FOREIGN KEY (company_id, parent_id) REFERENCES departments(company_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_departments_company_code ON departments (company_id, code) WHERE deleted_at IS NULL;

-- Designations Table
CREATE TABLE IF NOT EXISTS designations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT designations_company_id_id_unique UNIQUE (company_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_designations_company_code ON designations (company_id, code) WHERE deleted_at IS NULL;

-- Grades Table
CREATE TABLE IF NOT EXISTS grades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  level integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT grades_company_id_id_unique UNIQUE (company_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_grades_company_code ON grades (company_id, code) WHERE deleted_at IS NULL;

-- Cost Centers Table
CREATE TABLE IF NOT EXISTS cost_centers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT cost_centers_company_id_id_unique UNIQUE (company_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cost_centers_company_code ON cost_centers (company_id, code) WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 5. Row Level Security Configuration (All Tenant Tables)
-- ------------------------------------------------------------------------------

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_isolation_policy ON users;
CREATE POLICY users_isolation_policy ON users
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS roles_isolation_policy ON roles;
CREATE POLICY roles_isolation_policy ON roles
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS role_permissions_isolation_policy ON role_permissions;
CREATE POLICY role_permissions_isolation_policy ON role_permissions
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_roles_isolation_policy ON user_roles;
CREATE POLICY user_roles_isolation_policy ON user_roles
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sessions_isolation_policy ON sessions;
CREATE POLICY sessions_isolation_policy ON sessions
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

ALTER TABLE auth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_tokens_isolation_policy ON auth_tokens;
CREATE POLICY auth_tokens_isolation_policy ON auth_tokens
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

ALTER TABLE mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_recovery_codes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mfa_recovery_codes_isolation_policy ON mfa_recovery_codes;
CREATE POLICY mfa_recovery_codes_isolation_policy ON mfa_recovery_codes
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_logs_isolation_policy ON audit_logs;
CREATE POLICY audit_logs_isolation_policy ON audit_logs
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outbox_events_isolation_policy ON outbox_events;
CREATE POLICY outbox_events_isolation_policy ON outbox_events
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS departments_isolation_policy ON departments;
CREATE POLICY departments_isolation_policy ON departments
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

ALTER TABLE designations ENABLE ROW LEVEL SECURITY;
ALTER TABLE designations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS designations_isolation_policy ON designations;
CREATE POLICY designations_isolation_policy ON designations
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

ALTER TABLE grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE grades FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS grades_isolation_policy ON grades;
CREATE POLICY grades_isolation_policy ON grades
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

ALTER TABLE cost_centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_centers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cost_centers_isolation_policy ON cost_centers;
CREATE POLICY cost_centers_isolation_policy ON cost_centers
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

-- ------------------------------------------------------------------------------
-- 6. Role Permissions Grants
-- ------------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hrms_app, hrms_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO hrms_readonly;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hrms_app, hrms_worker;

-- Prevent UPDATE / DELETE on append-only audit_logs and sample_audit_logs tables for application roles
REVOKE UPDATE, DELETE ON audit_logs, sample_audit_logs FROM hrms_app, hrms_worker;
