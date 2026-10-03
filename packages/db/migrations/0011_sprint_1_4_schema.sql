-- ==============================================================================
-- 0011_sprint_1_4_schema.sql
-- Sprint 1.4 Core Platform & Phase 1 Closure Schema:
-- 1. custom_field_definitions: extensible dynamic field definitions per entity
-- 2. import_jobs: asynchronous & batched bulk data import job tracker
-- 3. Row Level Security (RLS) enforcement & Composite Foreign Keys
-- 4. Triggers and Role Grants to hrms_app and hrms_worker
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Custom Field Definitions Table (P1-ORG-04)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS custom_field_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  entity text NOT NULL CHECK (entity IN ('employee', 'department', 'location')),
  key text NOT NULL,
  label text NOT NULL,
  type text NOT NULL CHECK (type IN ('text', 'number', 'date', 'select', 'boolean', 'json')),
  required boolean NOT NULL DEFAULT false,
  options jsonb DEFAULT '[]'::jsonb,
  section text NOT NULL DEFAULT 'general',
  sort_order integer NOT NULL DEFAULT 0,
  view_permission text,
  edit_permission text,
  validation jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT custom_field_definitions_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT custom_field_definitions_company_entity_key_unique UNIQUE (company_id, entity, key)
);

CREATE INDEX IF NOT EXISTS idx_custom_field_definitions_lookup
  ON custom_field_definitions (company_id, entity, sort_order)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 2. Bulk Import Jobs Table (P1-EMP-06)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  file_id uuid,
  entity text NOT NULL CHECK (entity IN ('employee')) DEFAULT 'employee',
  status text NOT NULL CHECK (status IN ('pending', 'validated', 'processing', 'completed', 'failed')) DEFAULT 'pending',
  total_rows integer NOT NULL DEFAULT 0,
  valid_rows integer NOT NULL DEFAULT 0,
  error_rows integer NOT NULL DEFAULT 0,
  errors jsonb DEFAULT '[]'::jsonb,
  summary jsonb DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  CONSTRAINT import_jobs_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT fk_import_jobs_file FOREIGN KEY (company_id, file_id) REFERENCES files(company_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_status
  ON import_jobs (company_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 3. Row Level Security (RLS) Enforcement
-- ------------------------------------------------------------------------------
ALTER TABLE custom_field_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_field_definitions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS custom_field_definitions_tenant_isolation ON custom_field_definitions;
CREATE POLICY custom_field_definitions_tenant_isolation ON custom_field_definitions
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS import_jobs_tenant_isolation ON import_jobs;
CREATE POLICY import_jobs_tenant_isolation ON import_jobs
  FOR ALL TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

-- Supporting index for dashboard new joiners query
CREATE INDEX IF NOT EXISTS idx_employees_company_doj
  ON employees (company_id, doj)
  WHERE deleted_at IS NULL;

-- ------------------------------------------------------------------------------
-- 4. Automatic Timestamp Update Triggers
-- ------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_set_updated_at_custom_field_definitions ON custom_field_definitions;
CREATE TRIGGER trg_set_updated_at_custom_field_definitions
  BEFORE UPDATE ON custom_field_definitions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_set_updated_at_import_jobs ON import_jobs;
CREATE TRIGGER trg_set_updated_at_import_jobs
  BEFORE UPDATE ON import_jobs
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------------------------
-- 5. Role Grants to Application and Worker Roles
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON custom_field_definitions TO hrms_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON import_jobs TO hrms_app;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_worker') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON custom_field_definitions TO hrms_worker;
    GRANT SELECT, INSERT, UPDATE, DELETE ON import_jobs TO hrms_worker;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hrms_readonly') THEN
    GRANT SELECT ON custom_field_definitions TO hrms_readonly;
    GRANT SELECT ON import_jobs TO hrms_readonly;
  END IF;
END $$;
