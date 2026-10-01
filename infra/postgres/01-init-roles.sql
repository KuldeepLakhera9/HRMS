-- ==============================================================================
-- 01-init-roles.sql: Database Initialization for Docker Entrypoint
-- Creates standard roles, sets timeouts, and configures the hrms_db database.
-- ==============================================================================

-- 1. Create Application Database if needed
SELECT 'CREATE DATABASE hrms_db'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'hrms_db')\gexec

\connect hrms_db;

-- 2. Create Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- 3. Create Dedicated Roles
DO $$
BEGIN
  -- 1. hrms_owner: Owns schemas, runs migrations, executes DDL
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'hrms_owner') THEN
    CREATE ROLE hrms_owner WITH LOGIN PASSWORD 'hrms_owner_password' CREATEROLE;
  END IF;

  -- 2. hrms_app: DML only for web/API; NO BYPASSRLS
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'hrms_app') THEN
    CREATE ROLE hrms_app WITH LOGIN PASSWORD 'hrms_app_password' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;

  -- 3. hrms_worker: DML for background job workers; NO BYPASSRLS
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'hrms_worker') THEN
    CREATE ROLE hrms_worker WITH LOGIN PASSWORD 'hrms_worker_password' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;

  -- 4. hrms_readonly: Read-only for reporting and audit
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'hrms_readonly') THEN
    CREATE ROLE hrms_readonly WITH LOGIN PASSWORD 'hrms_readonly_password' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- 4. Role Defaults & Timeouts (AGENTS.md Section 4)
ALTER ROLE hrms_app SET statement_timeout = '5s';
ALTER ROLE hrms_app SET idle_in_transaction_session_timeout = '10s';

ALTER ROLE hrms_worker SET statement_timeout = '60s';
ALTER ROLE hrms_worker SET idle_in_transaction_session_timeout = '30s';

ALTER ROLE hrms_readonly SET statement_timeout = '30s';
ALTER ROLE hrms_readonly SET idle_in_transaction_session_timeout = '10s';

-- 5. Grant Ownership, Admin Option & Usage
GRANT ALL PRIVILEGES ON DATABASE hrms_db TO hrms_owner;
GRANT ALL ON SCHEMA public TO hrms_owner;
ALTER SCHEMA public OWNER TO hrms_owner;

-- PostgreSQL 16 requirement: grant admin option on created roles to hrms_owner
GRANT hrms_app, hrms_worker, hrms_readonly TO hrms_owner WITH ADMIN OPTION;

GRANT USAGE ON SCHEMA public TO hrms_app, hrms_worker, hrms_readonly;
