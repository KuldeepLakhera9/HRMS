-- ==============================================================================
-- 0002_core_and_proof_schema.sql
-- Core company schema and tenant proof tables demonstrating:
-- 1. RLS with FORCE ROW LEVEL SECURITY
-- 2. Composite Foreign Keys (company_id, parent_id) -> (company_id, id)
-- 3. Append-only trigger enforcement
-- 4. Role grants for hrms_app and hrms_worker
-- ==============================================================================

-- 1. Companies Table (Single Company / Multi-Tenant Ready)
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  legal_name text NOT NULL,
  timezone text DEFAULT 'Asia/Kolkata' NOT NULL,
  currency text DEFAULT 'INR' NOT NULL,
  fiscal_year_start_month integer DEFAULT 4 NOT NULL,
  settings jsonb DEFAULT '{}'::jsonb NOT NULL,
  domain citext NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- 2. Sample Tenant Table (Parent Entity)
CREATE TABLE IF NOT EXISTS sample_tenant_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT sample_tenant_items_company_id_id_unique UNIQUE (company_id, id)
);

-- 3. Sample Tenant Child Table with Composite Foreign Key
-- NOTE: Foreign key (company_id, parent_id) guarantees cross-tenant references are impossible.
CREATE TABLE IF NOT EXISTS sample_tenant_subitems (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  parent_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT sample_tenant_subitems_company_id_id_unique UNIQUE (company_id, id),
  CONSTRAINT fk_sample_subitems_parent_composite
    FOREIGN KEY (company_id, parent_id)
    REFERENCES sample_tenant_items(company_id, id)
    ON DELETE CASCADE
);

-- 4. Sample Append-Only Audit Table
CREATE TABLE IF NOT EXISTS sample_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  action text NOT NULL,
  details text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  row_version integer DEFAULT 1 NOT NULL,
  CONSTRAINT sample_audit_logs_company_id_id_unique UNIQUE (company_id, id)
);

-- 5. Row Level Security Configuration
ALTER TABLE sample_tenant_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sample_tenant_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sample_tenant_items_isolation_policy ON sample_tenant_items;
CREATE POLICY sample_tenant_items_isolation_policy ON sample_tenant_items
  FOR ALL
  TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

ALTER TABLE sample_tenant_subitems ENABLE ROW LEVEL SECURITY;
ALTER TABLE sample_tenant_subitems FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sample_tenant_subitems_isolation_policy ON sample_tenant_subitems;
CREATE POLICY sample_tenant_subitems_isolation_policy ON sample_tenant_subitems
  FOR ALL
  TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

ALTER TABLE sample_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sample_audit_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sample_audit_logs_isolation_policy ON sample_audit_logs;
CREATE POLICY sample_audit_logs_isolation_policy ON sample_audit_logs
  FOR ALL
  TO hrms_app, hrms_worker
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());

-- 6. Append-Only Trigger
DROP TRIGGER IF EXISTS trg_sample_audit_logs_append_only ON sample_audit_logs;
CREATE TRIGGER trg_sample_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON sample_audit_logs
  FOR EACH ROW EXECUTE FUNCTION reject_update_delete();

-- 7. Grant Permissions to Application Roles
GRANT USAGE ON SCHEMA public TO hrms_app, hrms_worker, hrms_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hrms_app, hrms_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO hrms_readonly;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hrms_app, hrms_worker;

-- Prevent UPDATE / DELETE on append-only table directly for application roles
REVOKE UPDATE, DELETE ON sample_audit_logs FROM hrms_app, hrms_worker;
