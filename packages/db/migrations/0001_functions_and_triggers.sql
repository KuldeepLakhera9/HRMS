-- ==============================================================================
-- 0001_functions_and_triggers.sql
-- RLS helper functions and generic triggers.
-- ==============================================================================

-- 1. Helper function: app_company_id()
-- Reads 'app.company_id' set via set_config('app.company_id', ..., true)
CREATE OR REPLACE FUNCTION app_company_id() RETURNS uuid AS $$
BEGIN
  RETURN NULLIF(current_setting('app.company_id', true), '')::uuid;
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;

-- 2. Helper function: app_user_id()
-- Reads 'app.user_id' set via set_config('app.user_id', ..., true)
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid AS $$
BEGIN
  RETURN NULLIF(current_setting('app.user_id', true), '')::uuid;
END;
$$ LANGUAGE plpgsql STABLE PARALLEL SAFE;

-- 3. Generic trigger: set_updated_at()
-- Automatically updates updated_at timestamp on row modification
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Generic trigger: reject_update_delete()
-- Enforces append-only semantics for audit logs, ledgers, and punch records
CREATE OR REPLACE FUNCTION reject_update_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only. UPDATE and DELETE operations are strictly prohibited.', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
