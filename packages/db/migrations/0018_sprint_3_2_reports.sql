-- Migration: 0018_sprint_3_2_reports.sql
-- Description: Adds report_runs and report_schedules with RLS and composite FKs
-- Reversible: DROP TABLE IF EXISTS report_schedules, report_runs CASCADE;

-- 1. report_runs
CREATE TABLE IF NOT EXISTS report_runs (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    report_key TEXT NOT NULL,
    params JSONB,
    params_hash TEXT,
    requested_by UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
    rows INTEGER,
    file_id UUID,
    duration_ms INTEGER,
    error TEXT,
    row_version INTEGER NOT NULL DEFAULT 1,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,
    CONSTRAINT report_runs_company_id_id_key UNIQUE (company_id, id),
    CONSTRAINT fk_report_runs_company_user FOREIGN KEY (company_id, requested_by) REFERENCES users(company_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_report_runs_company_user_created 
    ON report_runs (company_id, requested_by, created_at DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_report_runs_company_key_created 
    ON report_runs (company_id, report_key, created_at DESC)
    WHERE deleted_at IS NULL;

-- 2. report_schedules
CREATE TABLE IF NOT EXISTS report_schedules (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    report_key TEXT NOT NULL,
    params JSONB,
    cron TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    format TEXT NOT NULL DEFAULT 'csv' CHECK (format IN ('csv', 'xlsx')),
    recipients JSONB,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    last_run_at TIMESTAMPTZ,
    row_version INTEGER NOT NULL DEFAULT 1,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,
    CONSTRAINT report_schedules_company_id_id_key UNIQUE (company_id, id)
);

CREATE INDEX IF NOT EXISTS idx_report_schedules_company_active 
    ON report_schedules (company_id, active)
    WHERE deleted_at IS NULL;

-- 3. Row Level Security Policies
ALTER TABLE report_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_runs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_report_runs ON report_runs;
CREATE POLICY tenant_isolation_report_runs ON report_runs
    FOR ALL
    USING (company_id = NULLIF(current_setting('app.company_id', true), '')::UUID)
    WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::UUID);

ALTER TABLE report_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_schedules FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_report_schedules ON report_schedules;
CREATE POLICY tenant_isolation_report_schedules ON report_schedules
    FOR ALL
    USING (company_id = NULLIF(current_setting('app.company_id', true), '')::UUID)
    WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::UUID);

-- 4. Grants to hrms_app
GRANT SELECT, INSERT, UPDATE, DELETE ON report_runs TO hrms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON report_schedules TO hrms_app;
