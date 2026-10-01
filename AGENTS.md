# AGENTS.md - HRMS Platform (standing rules for every agent session)

## 1. Project
Production-grade, self-hosted HRMS (Keka/greytHR class). Multi-role, multi-tenant-ready, deployed in our own data center.
Sources of truth (read before planning, in this order):
1. `docs/PHASE1_SPEC.md` - exact scope for the current phase (PostgreSQL edition)
2. `docs/HRMS_Phase_Plan.md` - phases, task IDs, gates
3. `docs/HRMS_Project_Blueprint.pdf` - background only. It was written for MongoDB: its sections 7 (data model), 9.4 (geofence query) and 16.3-16.4 (database operations) are SUPERSEDED by PHASE1_SPEC.md (PostgreSQL). Everything else still applies.
If sources conflict, PHASE1_SPEC wins, then Phase Plan, then Blueprint. Never silently deviate: state the conflict and ask.

## 2. Fixed stack
TypeScript (strict), Node.js current Active LTS, pnpm workspaces + Turborepo, Next.js (latest stable, App Router), React, Tailwind CSS, shadcn/ui,
TanStack Query + Table, React Hook Form + Zod, **PostgreSQL (current stable major) + PostGIS + pg_trgm + citext**, **Drizzle ORM + drizzle-kit + node-postgres**,
Redis (ioredis), BullMQ, MinIO via AWS SDK v3, Pino, Vitest, Testcontainers, Playwright, Docker. PgBouncer (transaction mode) in front of Postgres in staging/production.
Do not add frameworks, databases, brokers or paid SaaS without asking. Verify library APIs against current docs; never guess versions or APIs.

## 3. Architecture rules (non-negotiable)
- Modular monolith. Layers: route handler (thin) -> service (all business logic and authorization) -> repository (data access) -> Drizzle schema.
- Module layout: `packages/core/<module>/{schema,repository,service,validation,policy,events}.ts`. Modules talk only through exported service functions or events; never import another module's tables or repositories.
- Every route is defined through `defineRoute({ permission, schema, handler })`: authenticate, build `ctx`, rate-limit, validate with Zod, authorize, run the service inside `withTenant(ctx, tx => ...)`, map errors, set requestId. No route bypasses it.
- Every service function takes `ctx` first (companyId, userId, employeeId, roles, permissions, requestId). Authorization is checked in the service with `can()`; hiding UI is never security.
- Typed errors only (`NotFound`, `Forbidden`, `Unauthorized`, `ValidationError`, `Conflict`, `RateLimited`), mapped to HTTP in one place. Never leak stack traces, SQL or internal ids to clients.
- No business logic in React components or route handlers.

## 4. Database rules (PostgreSQL)
- **Tenant isolation is enforced twice**: (1) repositories always filter by `company_id`; (2) PostgreSQL Row Level Security with `FORCE ROW LEVEL SECURITY` using `current_setting('app.company_id')`, set by `withTenant()` via `set_config(..., true)` inside the transaction. The app connects as a non-owner role without BYPASSRLS. Never use SET (session-level) because of connection pooling.
- Every tenant table has `UNIQUE (company_id, id)` and uses **composite foreign keys** `(company_id, x_id) -> x(company_id, id)` so cross-tenant references are impossible.
- Primary keys: UUIDv7 generated in the app (time-ordered). Timestamps: `timestamptz` in UTC. Enums: `text` + CHECK constraints (easier to migrate). Email: `citext`.
- Base columns on tenant tables: id, company_id, created_at, updated_at, created_by, updated_by, deleted_at (soft delete, partial indexes `WHERE deleted_at IS NULL`), row_version (optimistic locking).
- Money: `numeric(14,2)` or integer paise, never floats. Use effective dating for job/salary changes; never overwrite history.
- Append-only tables (audit_logs, ledgers, punches): the app role has INSERT and SELECT only, plus a trigger that rejects UPDATE/DELETE. No update/delete code paths.
- Migrations: SQL-first via drizzle-kit, versioned, reviewed, backward compatible (expand, migrate, contract), run by a separate owner role. RLS policies, triggers, extensions and partitions live in hand-written SQL migrations. Never edit an applied migration.
- Every query path has an index in the same change as the query (leading with `company_id`). List endpoints use keyset (cursor) pagination, explicit column selection, max page size 100. No unbounded queries, no N+1, no `SELECT *`, no OFFSET pagination on large tables.
- Multi-row writes use transactions; use `SELECT ... FOR UPDATE` / `SKIP LOCKED` for contention points; idempotency keys for retry-sensitive POSTs; transactional outbox for events.
- Set `statement_timeout` and `idle_in_transaction_session_timeout` on app roles. Keep transactions short; never call external services (email, HTTP) inside a transaction.
- Sensitive fields (bank, PAN, Aadhaar, MFA secrets) use app-level AES-256-GCM (keyId versioned) and are masked by default unless the caller has the specific permission.

## 5. Security rules
- Passwords: Argon2id. Sessions: opaque random tokens, stored hashed; HttpOnly + Secure + SameSite cookies; never tokens in localStorage.
- MFA (TOTP) mandatory for admin, HR, accountant roles. Step-up auth for sensitive actions.
- Validate every input with Zod server-side. Check Origin on mutating requests. Rate-limit auth and write endpoints (Redis).
- No secrets in code, logs, tests or images. Config via Zod-validated env. Redact secrets and PII in logs and audit diffs.
- Uploads: size and type limits, magic-byte check, private buckets, short-lived signed URLs only after a permission check.
- Security headers + CSP (nonce). Lockfile pinned; dependency audit and secret scan in CI.
- Prevent IDOR: every client-supplied id is verified against tenant AND scope via `can()` with target.

## 6. Performance rules (the app must never feel laggy)
- Server Components by default; Client Components only for interactivity; dynamic-import heavy widgets (org chart, charts, maps, editors).
- Server-side pagination/filter/sort for all tables; virtualize long lists; TanStack Query `staleTime`; optimistic updates for quick actions.
- Redis cache for hot, stable reads (effective permissions, org lookups, custom-field definitions) with explicit invalidation.
- Slow or heavy work goes to BullMQ workers, never into request handlers.
- Targets: API p95 read <= 200 ms, write <= 400 ms at 200 concurrent users on 5,000 employees. First-load JS per route <= 170 KB gzip. Each endpoint has a documented query budget (max number of SQL queries) asserted in tests. Every page has skeleton, empty, error and success states.

## 7. Code quality
- TypeScript strict, no `any` without a comment. ESLint + Prettier clean. Small functions, clear names, no dead code, no TODO without a task ID.
- Conventional Commits; one logical change per commit; branch per task e.g. `feat/P1-AUTH-01-login`.
- Tests are part of the task: unit, integration (real PostgreSQL via Testcontainers, running as the non-owner app role so RLS is exercised), e2e (Playwright), permission-matrix, query-plan and query-budget tests. A task without tests is not done.
- Public functions have short doc comments stating intent and the permission required.

## 8. Working protocol
1. Start in Planning mode. Produce the implementation plan and task list first; list assumptions and blocking questions in ONE batch; wait for approval before coding.
2. Work in small vertical slices (migration + indexes + service + route + UI + tests). After each slice run `pnpm verify` (lint, typecheck, test, build) and fix before continuing.
3. Never skip a failing test, loosen a lint rule, or disable a check to move on. If blocked, stop and report.
4. Do not touch files outside the task scope. No unrelated refactors. No destructive commands (drop database, force push, delete volumes) without explicit approval.
5. At the end of every sprint produce a walkthrough: what was built, how to run it, acceptance checklist with evidence (test names, query counts, screenshots), known gaps, next steps. Then stop and wait.
6. If a requirement is ambiguous, choose the configurable and safer option, record a short ADR in `docs/decisions/`, and flag it in the walkthrough.

## 9. Definition of Done
Permissions enforced and tested per role; tenant isolation tested at both layers (repository and RLS); validation and error handling; audit entries for sensitive actions; loading/empty/error states; keyboard accessible and responsive; indexes + migration added and reversible plan documented; query budget and plan tests; logs and metrics; OpenAPI updated; seed updated; docs updated; `pnpm verify` green.
