-- 0006_company_columns.sql
-- Add logo_url, date_format, and deleted_at to companies per docs/PHASE1_SPEC.md

ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS date_format text DEFAULT 'DD/MM/YYYY' NOT NULL;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
