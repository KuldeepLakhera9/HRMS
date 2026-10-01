-- ==============================================================================
-- 0000_extensions_and_roles.sql
-- Installs required PostgreSQL extensions and configures the 4 standard roles.
-- ==============================================================================

-- 1. PostgreSQL Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- 2. Database Roles
DO $$
BEGIN
  -- 1. hrms_owner: owns schemas and executes migrations
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'hrms_owner') THEN
    CREATE ROLE hrms_owner WITH LOGIN PASSWORD 'hrms_owner_password' CREATEROLE;
  END IF;

  -- 2. hrms_app: DML only for web/API; NO BYPASSRLS
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'hrms_app') THEN
    CREATE ROLE hrms_app WITH LOGIN PASSWORD 'hrms_app_password' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;

  -- 3. hrms_worker: DML for background job worker; NO BYPASSRLS
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'hrms_worker') THEN
    CREATE ROLE hrms_worker WITH LOGIN PASSWORD 'hrms_worker_password' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;

  -- 4. hrms_readonly: Read-only for reporting and audit
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'hrms_readonly') THEN
    CREATE ROLE hrms_readonly WITH LOGIN PASSWORD 'hrms_readonly_password' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- 3. Role Defaults & Timeouts (AGENTS.md Section 4)
ALTER ROLE hrms_app SET statement_timeout = '5s';
ALTER ROLE hrms_app SET idle_in_transaction_session_timeout = '10s';

ALTER ROLE hrms_worker SET statement_timeout = '60s';
ALTER ROLE hrms_worker SET idle_in_transaction_session_timeout = '30s';

ALTER ROLE hrms_readonly SET statement_timeout = '30s';
ALTER ROLE hrms_readonly SET idle_in_transaction_session_timeout = '10s';
