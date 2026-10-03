-- ==============================================================================
-- 0010_sprint_1_3_schema.sql
-- Sprint 1.3 Core Platform Schema:
-- 1. employee_documents: document vault tracking with verification & expiry
-- 2. change_requests: employee profile change requests with approval workflow
-- 3. notifications: in-app notifications with unread tracking & retention
-- 4. notification_preferences: user notification channel preferences
-- 5. Row Level Security (RLS) enforcement & Composite Foreign Keys
-- 6. Triggers and Role Grants to hrms_app and hrms_worker
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Employee Documents Table (Document Vault)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS employee_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  type text NOT NULL,
  file_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'verified', 'rejected')) DEFAULT 'pending',
  expiry date,
  verified_by uuid,
  verification_comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT employee_documents_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT fk_employee_documents_employee FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_employee_documents_file FOREIGN KEY (company_id, file_id) REFERENCES files(company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_employee_documents_verifier FOREIGN KEY (company_id, verified_by) REFERENCES users(company_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_employee_documents_emp_type
  ON employee_documents (company_id, employee_id, type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_employee_documents_expiry
  ON employee_documents (company_id, expiry) WHERE deleted_at IS NULL AND expiry IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employee_documents_status
  ON employee_documents (company_id, status) WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 2. Change Requests Table
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  changes jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
  decided_by uuid,
  comment text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT change_requests_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT fk_change_requests_employee FOREIGN KEY (company_id, employee_id) REFERENCES employees(company_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_change_requests_decider FOREIGN KEY (company_id, decided_by) REFERENCES users(company_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_change_requests_status_created
  ON change_requests (company_id, status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_change_requests_emp_created
  ON change_requests (company_id, employee_id, created_at DESC) WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 3. Notifications Table
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  link text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT notifications_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT fk_notifications_user FOREIGN KEY (company_id, user_id) REFERENCES users(company_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (company_id, user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications (company_id, user_id) WHERE read_at IS NULL AND deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 4. Notification Preferences Table
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  channels jsonb NOT NULL DEFAULT '{"in_app": true, "email": true}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT notification_preferences_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT fk_notification_preferences_user FOREIGN KEY (company_id, user_id) REFERENCES users(company_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_preferences_user
  ON notification_preferences (company_id, user_id) WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 5. Row Level Security Configuration (Tenant Isolation)
-- ------------------------------------------------------------------------------
ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_documents_isolation_policy ON employee_documents;
CREATE POLICY employee_documents_isolation_policy ON employee_documents
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

ALTER TABLE change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS change_requests_isolation_policy ON change_requests;
CREATE POLICY change_requests_isolation_policy ON change_requests
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notifications_isolation_policy ON notifications;
CREATE POLICY notifications_isolation_policy ON notifications
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_preferences_isolation_policy ON notification_preferences;
CREATE POLICY notification_preferences_isolation_policy ON notification_preferences
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

-- ------------------------------------------------------------------------------
-- 6. Triggers for Automatic set_updated_at
-- ------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_employee_documents_updated_at ON employee_documents;
CREATE TRIGGER trg_employee_documents_updated_at
  BEFORE UPDATE ON employee_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_change_requests_updated_at ON change_requests;
CREATE TRIGGER trg_change_requests_updated_at
  BEFORE UPDATE ON change_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_notifications_updated_at ON notifications;
CREATE TRIGGER trg_notifications_updated_at
  BEFORE UPDATE ON notifications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_notification_preferences_updated_at ON notification_preferences;
CREATE TRIGGER trg_notification_preferences_updated_at
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------------------------
-- 7. Role Grants to Application and Worker Roles
-- ------------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON employee_documents TO hrms_app, hrms_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON change_requests TO hrms_app, hrms_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO hrms_app, hrms_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_preferences TO hrms_app, hrms_worker;
