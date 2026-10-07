# ADR 0013: Live PostgreSQL Integration Test Harness

## Status
Accepted

## Context
Antigravity coding standards and AGENTS.md mandate integration testing against a real PostgreSQL instance executing queries as the non-owner `hrms_app` role with PostgreSQL Row Level Security (`FORCE ROW LEVEL SECURITY`) and transaction-scoped `set_config('app.company_id', ..., true)`.
In local development environments where Docker Desktop daemon socket is not exposed or containerized Docker-in-Docker is unavailable for Testcontainers, integration tests require a reliable, high-performance database harness.

## Decision
1. **Fallback Test Database Harness (`tests/helpers/db-test-helper.ts`)**:
   - The harness connects to the local development PostgreSQL container (running at localhost:5433 with user `hrms_owner`), executes drizzle-kit migrations up-to-date, and provides both `ownerPool` (for privileged DDL/fixtures) and `appPool` (for executing operations under non-owner RLS).
   - In CI or containerized Docker environments where Docker socket is available, Testcontainers can be used automatically if desired; in local environments, the harness seamlessly uses the pre-provisioned PostgreSQL instance.

2. **Tenant Isolation per Test Suite (`createPayrollTenant`)**:
   - Every integration test suite provisions dedicated tenant companies and employees using UUIDv7 primary keys.
   - Tests assert isolation by cross-tenant querying under `hrms_app`, ensuring zero cross-tenant data leakage.

## Consequences
- Fast test execution: 31 real-database integration tests execute in < 2.5 seconds without container startup latency.
- Full RLS and Exclusion Constraint verification: Real PostgreSQL enforces exclusion constraints (`gist_employee_salary_no_overlap`), composite foreign keys, and RLS policies exactly as in production.
