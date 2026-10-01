# PHASE 1 SPEC (PostgreSQL edition): Platform Core, with Sprint 0 bootstrap

Scope source: `HRMS_Phase_Plan.md` Phase 0 (repo/CI bootstrap only) and Phase 1. Background: `HRMS_Project_Blueprint.pdf` (BP).
Goal: a secure, fast, scalable multi-role platform with organization structure, employee master, audit trail, notifications and file storage. After this phase the system can hold real employee data.

## 0. Out of scope (do NOT build now)
Attendance, geofencing, mobile app, leave, workflow engine, payroll, expenses, recruitment, performance, report builder, biometric.
Allowed groundwork only: `work_locations` carries nullable `center geography(Point,4326)` and `radius_meters` with the GIST index (used in Phase 2); PostGIS extension is installed now.
Profile change requests use a simple built-in approval now (replaced by the workflow engine in Phase 2).

## 1. Fixed decisions for this phase
| Topic | Decision |
|---|---|
| Database | PostgreSQL (current stable major) with extensions `postgis`, `pg_trgm`, `citext`, `pgcrypto`, `btree_gist`, `pg_stat_statements` |
| ORM / migrations | Drizzle ORM + drizzle-kit (SQL-first, TypeScript types) with node-postgres (`pg`) pool. Hand-written SQL migrations for RLS, triggers, partitions, extensions. Prisma is NOT used (weak PostGIS/RLS fit) |
| Connection pooling | App-level pg Pool (default max 10 per web instance, configurable) + PgBouncer transaction mode in staging/production. Code must be pooler-safe: only `SET LOCAL`/`set_config(...,true)` inside transactions, no session state, no advisory locks held across transactions |
| Tenancy | Multi-tenant-ready: `company_id` on every tenant table, composite FKs, and Row Level Security. Single company seeded |
| Auth | Custom session layer (NOT Auth.js): opaque revocable sessions, TOTP MFA, step-up auth, refresh tokens for the future mobile app |
| Real-time | Server-Sent Events from a Node route handler + Redis pub/sub |
| Files | MinIO (S3 API) via AWS SDK v3; private buckets; presigned POST/GET |
| Email | Nodemailer (SMTP) + React Email; Mailpit locally |
| Jobs | BullMQ worker app (`apps/worker`), fed by a transactional outbox |
| Country | India (INR, Asia/Kolkata defaults), configurable |

### Blueprint overrides (so the PDF does not confuse the agent)
| Blueprint (MongoDB) | Use instead |
|---|---|
| BP 5 Mongoose ODM | Drizzle ORM + drizzle-kit |
| BP 7 collections, indexes, embedding | Relational tables, constraints, JSONB only for flexible data (this spec section 4) |
| BP 9.4 `$geoNear` geofence query | PostGIS `ST_DWithin` / `ST_Contains` on `geography` (Phase 2) |
| BP 16.3-16.4 MongoDB replica set, PBM | Patroni HA cluster + PgBouncer + pgBackRest (infra phase; not built by the agent now) |
| Tenant filter in code only | Code filter + Row Level Security + composite foreign keys |

## 2. Sprint 0 - Bootstrap (do first)
- pnpm + Turborepo monorepo per BP section 6 (`apps/web`, `apps/worker`, `packages/{core,db,shared,config}`, `infra`, `docs`).
- TypeScript strict base config, ESLint (custom rule: only repositories may import Drizzle tables; only `packages/db` may create pools), Prettier, Husky + commitlint, `pnpm verify` = lint + typecheck + test + build.
- `packages/config`: Zod-validated env (fail fast). `.env.example` documented, no real secrets.
- `packages/shared`: typed errors, result helpers, constants, date utils, permission catalog.
- `packages/db`: pg Pool singleton (HMR-safe), Drizzle setup, `withTenant(ctx, fn)` helper (opens a transaction, runs `select set_config('app.company_id', $1, true)` and `app.user_id`, executes fn, commits), base column helpers, UUIDv7 generator, migration runner, seed framework.
- Database roles created by the first migration/init script: `hrms_owner` (owns objects, runs migrations), `hrms_app` (DML only, no BYPASSRLS), `hrms_worker` (same as app), `hrms_readonly`. Role defaults: `statement_timeout=5s` (API), `idle_in_transaction_session_timeout=10s`; worker gets longer timeouts.
- First migrations: extensions; `companies`; RLS helper function `app_company_id()`; generic trigger functions (`set_updated_at`, `reject_update_delete`); one example tenant table proving the RLS + composite-FK pattern with a test.
- Next.js base app: `/api/health` (liveness), `/api/ready` (Postgres + Redis ping), Pino logger with requestId, security headers + CSP (nonce), standalone build, production Dockerfile (multi-stage, non-root).
- `infra/docker-compose.dev.yml`: PostGIS image (current stable PostgreSQL), PgBouncer (profile), Redis, MinIO (+ bucket init), Mailpit, ClamAV (optional profile). `pg_stat_statements` enabled, `log_min_duration_statement=100ms`.
- CI (`.gitlab-ci.yml`): install (cached), lint, typecheck, unit, integration (Testcontainers), `drizzle-kit check`, apply migrations to an empty DB, build, dependency audit, image build. No manual steps.
- Test harness: Vitest, integration helper that starts a PostGIS Testcontainer, applies migrations as `hrms_owner`, and runs tests as `hrms_app` (so RLS is real); per-test isolation via template database or transaction rollback; Playwright config.
Acceptance: `docker compose up` + `pnpm dev` runs everything; `pnpm verify` green; health endpoints respond; RLS test proves a query without tenant context returns zero rows and a cross-tenant insert/reference fails; production image builds and runs.

## 3. Permission catalog (Phase 1)
Format `module.resource.action`; each grant has scope `self | team | department | location | company`.
```
auth.user.read|create|update|deactivate|reset_mfa     auth.session.read|revoke
auth.role.read|create|update|delete                    auth.role.assign
org.company.read|update       org.department.read|manage    org.designation.read|manage
org.grade.read|manage         org.costcenter.read|manage    org.location.read|manage
org.customfield.read|manage   org.chart.read
employee.profile.read|create|update|delete|export|import
employee.profile.view_sensitive      (bank, PAN, Aadhaar)
employee.history.read          employee.document.read|upload|verify|delete
employee.changerequest.create|approve
audit.log.read     audit.log.read_own
notification.preference.manage
```
Seed system roles (locked, `is_system = true`) per BP section 2.1: `super_admin`, `hr_manager`, `accountant`, `manager`, `employee`, `recruiter`, `auditor`. Custom roles allowed. MFA mandatory for super_admin, hr_manager, accountant.
Effective permissions = union over the user's roles, widest scope wins per key. Cached in Redis (`eff:{companyId}:{userId}`, TTL 5 min), invalidated immediately on role, role-assignment or user change.

## 4. Data model (Drizzle schema + SQL migrations)
Conventions: snake_case; tenant tables carry the base columns from AGENTS.md section 4; `UNIQUE (company_id, id)`; composite FKs; RLS enabled + forced with policy `USING (company_id = app_company_id()) WITH CHECK (company_id = app_company_id())`; unique indexes are partial `WHERE deleted_at IS NULL` where soft delete applies. Text status columns have CHECK constraints.

| Table | Columns (essentials) | Indexes / constraints |
|---|---|---|
| companies | id, name, legal_name, timezone, currency, fiscal_year_start_month, settings jsonb, domain citext | unique domain. (Not RLS-scoped by company_id; readable only for own id) |
| users | email citext, password_hash, status (invited/active/locked/disabled), mfa_enabled, mfa_secret_enc, failed_attempts, locked_until, last_login_at, perm_version, employee_id | unique (company_id,email); (company_id,employee_id) |
| user_roles | user_id, role_id | PK (user_id, role_id); composite FKs; index (company_id, role_id) |
| roles | name, description, is_system, requires_mfa, version | unique (company_id,name) |
| role_permissions | role_id, permission_key, scope (CHECK in 5 values) | PK (role_id, permission_key) |
| mfa_recovery_codes | user_id, code_hash, used_at | (user_id) |
| sessions | user_id, token_hash, refresh_hash, family_id, client_type, ip inet, user_agent, device_label, mfa_verified_at, step_up_until, last_seen_at, idle_expires_at, absolute_expires_at, revoked_at | unique token_hash; (company_id,user_id) WHERE revoked_at IS NULL; (absolute_expires_at) for cleanup |
| auth_tokens | user_id, type (invite/reset), token_hash, expires_at, used_at | unique token_hash; (expires_at) |
| employees | emp_code, first_name, last_name, dob, gender, marital_status, email_work, email_personal, phone, addresses jsonb, emergency_contacts jsonb, department_id, designation_id, grade_id, cost_center_id, location_id, manager_id, employment_type, doj, confirmation_date, status, job_effective_from, reporting_path uuid[], bank_enc, pan_enc, pan_blind_idx, aadhaar_enc, custom_fields jsonb, user_id, search_key | unique (company_id,emp_code); unique (company_id,pan_blind_idx) WHERE not null; (company_id,status,department_id); (company_id,manager_id); GIN (reporting_path) ; GIN (search_key gin_trgm_ops); (company_id,location_id); keyset index (company_id, created_at DESC, id DESC); CHECK cardinality(reporting_path) <= 25 |
| employee_history | employee_id, field, old_value jsonb, new_value jsonb, effective_from date, applied_at, changed_by, reason | (company_id,employee_id,effective_from DESC); partial index on (effective_from) WHERE applied_at IS NULL |
| employee_documents | employee_id, type, file_id, status (pending/verified/rejected), expiry, verified_by | (company_id,employee_id,type); (company_id,expiry) |
| change_requests | employee_id, changes jsonb, status, decided_by, comment | (company_id,status,created_at DESC) |
| departments | name, code, parent_id, head_employee_id, active | unique (company_id,code); (company_id,parent_id) |
| designations / grades / cost_centers | name, code, active (+ level for grades) | unique (company_id,code) |
| work_locations | name, code, address jsonb, timezone, center geography(Point,4326) NULL, radius_meters NULL, active | unique (company_id,code); GIST (center) |
| custom_field_definitions | entity, key, label, type, required, options jsonb, section, sort_order, view_permission, edit_permission, validation jsonb | unique (company_id,entity,key) |
| counters | key, seq | PK (company_id,key); updated with `UPDATE ... SET seq = seq + 1 RETURNING seq` (row lock) for emp_code |
| files | bucket, object_key, original_name, mime, size_bytes, sha256, status (pending/clean/rejected), owner_type, owner_id, uploaded_by | unique (bucket,object_key); (company_id,owner_type,owner_id) |
| audit_logs | id, ts, actor_id, actor_role, action, entity, entity_id, before jsonb, after jsonb, ip inet, user_agent, request_id, meta jsonb | **Partitioned by RANGE (ts), monthly**, partitions pre-created 3 months ahead by a worker job; PK (id, ts); (company_id,entity,entity_id,ts DESC); (company_id,actor_id,ts DESC); (company_id,action,ts DESC); BRIN (ts). Append-only trigger; app role INSERT/SELECT only |
| notifications | user_id, type, title, body, link, read_at | (company_id,user_id,created_at DESC) with partial (company_id,user_id) WHERE read_at IS NULL; retention job deletes > 90 days in batches |
| notification_preferences | user_id, channels jsonb | unique (company_id,user_id) |
| outbox_events | id, aggregate, type, payload jsonb, created_at, processed_at, attempts | partial index (created_at) WHERE processed_at IS NULL; relay uses `FOR UPDATE SKIP LOCKED` |
| idempotency_keys | key, route, response_hash, expires_at | unique (company_id,key); (expires_at) |

### Reporting-line design (critical for speed)
`employees.reporting_path uuid[]` = ordered ancestor employee ids (top ... direct manager). Team scope = one indexed query `WHERE company_id = $1 AND reporting_path @> ARRAY[$manager]` (GIN). No recursion at request time.
When a manager changes (single transaction): reject if the new manager's path contains the employee id (cycle); set the employee's path to `new_manager.path || new_manager.id`; update all descendants with `UPDATE employees SET reporting_path = $new_prefix || reporting_path[$old_len+1:] WHERE reporting_path @> ARRAY[$employee_id]`; write history + audit + outbox event. Depth cap 25 (CHECK).

### Effective-dated changes
Job changes create `employee_history` rows. If `effective_from <= today` apply immediately; if future-dated, the daily worker job `employee.apply_scheduled_changes` applies them (and fixes `reporting_path` if the manager changes). The current snapshot is on the employee row for fast reads.

### Field encryption
AES-256-GCM in the app, ciphertext format `v1:<keyId>:<iv>:<tag>:<ct>`, keys from env/Vault as `{keyId: base64key}` (encrypt with newest, decrypt with any, rotation job re-encrypts). Blind index = HMAC-SHA256(normalized value, separate key) for PAN uniqueness/search. API returns masked values (`XXXXXX1234`) unless the caller has `employee.profile.view_sensitive`; each unmask requires step-up and writes an audit entry. (Disk encryption for the database volume is an infrastructure task, LUKS.)

### Transactional outbox
Domain events (employee.created, role.changed, change_request.decided, document.uploaded, ...) are inserted into `outbox_events` in the same transaction as the change. A relay job (poll every 1 s, `FOR UPDATE SKIP LOCKED`, optionally woken by `LISTEN/NOTIFY`) publishes to BullMQ queues (notifications, audit enrichment, cache invalidation). Consumers are idempotent.

### Search
Directory search uses `search_key` (lowercased `first last emp_code`) with a `pg_trgm` GIN index, so `ILIKE '%term%'` is fast; ranking by similarity optional. Filters use the composite indexes above. Pagination is keyset on `(sort_key, id)`.

## 5. Authentication and sessions
- Password: min 12 chars, strength check (zxcvbn-ts), not equal to email/name; Argon2id with current OWASP-recommended parameters; constant-time responses and a dummy hash for unknown emails (no user enumeration; uniform error text).
- Session token: 256-bit random; store only SHA-256 hash; web cookie `__Host-` prefix over HTTPS, HttpOnly, Secure, SameSite=Lax, Path=/. Idle timeout 30 min (configurable), absolute 12 h. Lookups served from Redis, backed by Postgres. `last_seen_at` is updated at most once per minute (kept in Redis, flushed in batches) to avoid write amplification.
- Mobile/API clients: same opaque access token (15 min) + rotating refresh token; reuse of an old refresh token revokes the whole family.
- Login: email+password -> if MFA required/enabled, `mfa_required` with a short-lived challenge -> TOTP (30 s window, +/-1 step) or recovery code -> session issued. New session id on login; privilege changes invalidate sessions.
- Lockout: 5 failures -> 15 min lock with exponential backoff; Redis rate limit per IP and per account; Origin check on mutating requests; custom header required on API calls.
- Invite/activation and reset: single-use hashed tokens (24 h invite, 30 min reset), set password + MFA enrollment, all sessions revoked after reset.
- MFA: otplib TOTP, secret encrypted, 10 hashed recovery codes, admin reset (audited, step-up).
- Step-up: `POST /auth/step-up` sets `step_up_until` for 10 min; `requireStepUp(ctx)` guards sensitive actions (unmask, exports, role changes, MFA reset).
- Session management: list own sessions, revoke one/all; admin can revoke a user's sessions.

## 6. API (all under `/api/v1`, JSON, defined only through `defineRoute`)
Conventions: error shape `{ error: { code, message, details?, requestId } }`; list shape `{ data[], nextCursor, total? }` (total only on request, computed with a bounded count); `X-Request-Id` on responses; `Idempotency-Key` on POST creates; OpenAPI generated from Zod at `/api/v1/openapi.json` (non-prod or admin only).
```
Auth:      POST /auth/login  /auth/mfa/verify  /auth/logout  /auth/refresh  /auth/step-up  /auth/forgot  /auth/reset  /auth/activate
           POST /auth/mfa/enroll  /auth/mfa/confirm  /auth/mfa/recovery-codes   GET /auth/me  /auth/sessions   DELETE /auth/sessions/:id
Users:     GET|POST /users   GET|PATCH /users/:id   POST /users/:id/deactivate | reactivate | reset-mfa | revoke-sessions | resend-invite
Roles:     GET|POST /roles   GET|PATCH|DELETE /roles/:id   PUT /users/:id/roles   GET /permissions/catalog   GET /users/:id/effective-permissions
Org:       GET|PATCH /company   CRUD /departments /designations /grades /cost-centers /locations   GET /org/chart?parentId= (lazy children)
Employees: GET|POST /employees   GET|PATCH /employees/:id   GET /employees/:id/history   POST /employees/:id/job-change
           GET /employees/:id/sensitive (step-up)   GET /employees/directory (light projection)   GET /employees/:id/team
           POST /employees/import -> GET /employees/import/:jobId -> POST /employees/import/:jobId/confirm   POST /employees/export
Documents: POST /files/presign   POST /files/:id/confirm   GET /files/:id/url   GET|POST /employees/:id/documents   PATCH /employees/:id/documents/:docId/verify
Requests:  POST /employees/:id/change-requests   GET /change-requests   POST /change-requests/:id/approve | reject
Custom:    CRUD /custom-fields
Audit:     GET /audit-logs (filters: actor, entity, action, date range; keyset cursor)
Notify:    GET /notifications   GET /notifications/unread-count   PATCH /notifications/:id/read   POST /notifications/read-all
           GET /notifications/stream (SSE)   GET|PUT /me/notification-preferences
System:    GET /health  /ready
```

## 7. Background jobs (BullMQ, idempotent, retry with backoff, dead-letter queue)
`outbox.relay`, `notification.send`, `import.process`, `file.scan` (ClamAV optional + mandatory magic-byte/size checks), `employee.apply_scheduled_changes` (daily), `audit.partition_maintenance` (monthly partitions ahead), `notification.retention`, `session.cleanup`, `cache.warm` (optional).
Audit rule: login, MFA changes, role/permission changes, sensitive-field reads, exports and deactivations are written to `audit_logs` synchronously inside the same transaction as the action; other events go through the outbox.

## 8. UI (Next.js App Router, shadcn/ui, Tailwind)
Design: clean, card-based, Keka-like. Tokens for color/spacing/radius/typography, light + dark, mobile-first responsive, WCAG 2.1 AA. `next/font`, skeleton loading everywhere, optimistic updates for quick actions, toasts (Sonner).
- `/login` (MFA step, recovery code option), `/activate`, `/forgot`, `/reset`, `/security` (password, MFA, sessions list with revoke)
- App shell: collapsible sidebar built from the user's permissions, top bar (search trigger, notifications bell with live count, theme toggle, profile menu), breadcrumbs, command palette (Ctrl+K: navigate, search people, quick actions)
- Home dashboards per role with real data cards (headcount, joiners, pending change requests, document expiries, admin audit highlights), each card loading independently
- People: directory (server-side search, filters, saved views, column chooser, virtualized table, grid/list), employee profile with tabs (Overview, Job and history timeline, Documents, Personal and contact, Sensitive with masked values and reveal via step-up, Custom fields, Activity), multi-step create/edit forms with inline validation and autosave drafts, bulk import wizard (upload, validate preview with row errors, confirm, error CSV)
- Organization: departments tree, designations, grades, cost centers, locations, company settings; org chart (lazy children, zoom/pan/collapse/search, click to profile)
- Admin: users (invite, deactivate, reset MFA, revoke sessions), roles and permission matrix editor, effective-permission viewer ("why can this user see X"), custom fields builder, audit log viewer (filters, diff viewer, export), notification preferences
- Shared: data table (server pagination, sorting, filters, column chooser, permission-aware CSV export), form kit, empty/loading/error states, confirm dialogs, `<Can>` component (UI hint only)
Performance: Server Components for shells and first data; Client Components only for interactive parts; dynamic import for org chart and editors; per-resource `staleTime`; prefetch on hover; no layout shift.

## 9. Observability and operations
Pino JSON logs with requestId, userId, companyId (no secrets/PII); `/api/health`, `/api/ready`; Prometheus metrics at `/api/metrics` (internal only): latency histogram per route, error rate, queue depth, cache hit ratio, pg pool usage (total/idle/waiting), query duration, queries per request; `pg_stat_statements` enabled; slow-query log at 100 ms; graceful shutdown for web and worker (drain pool).

## 10. Testing requirements
- Unit: `can()` all scopes; reporting-path maintenance and cycle rejection; field encryption + rotation; password policy; TOTP window; token hashing; keyset pagination helper.
- Integration (real PostgreSQL, running as `hrms_app`): auth flows incl. lockout and refresh-reuse revocation; role change invalidates cache; **RLS tests** (no tenant context -> zero rows; company A cannot read/write company B even with raw SQL as `hrms_app`); composite FK blocks cross-tenant references; IDOR (manager cannot read employee outside reporting line); transactions and outbox atomicity; append-only trigger rejects UPDATE/DELETE on audit_logs; audit rows written for every sensitive action; import pipeline.
- Permission-matrix test generated from the route registry (every role x every route -> expected 200/403).
- Query-plan test: seed >= 5,000 employees, run `ANALYZE`, run `EXPLAIN (FORMAT JSON)` on key queries (directory, by manager, by department/status, reporting_path team, audit by entity, notifications) and fail on Seq Scan of large tables.
- Query-budget test: each endpoint asserts a maximum number of SQL statements per request (e.g. directory <= 3, profile <= 5) to catch N+1.
- E2E (Playwright): login + MFA, activate invited user, create employee, role-restricted views, reveal sensitive field with step-up, upload document, import wizard, live notification.
- Load (k6): `pnpm seed:load` creates 5,000 employees; 200 virtual users on login, directory search, profile view, notifications, writes; thresholds p95 read <= 200 ms, write <= 400 ms, errors < 1%. Report pg pool waiting count and top `pg_stat_statements` queries.
- Security checks in CI: dependency audit, secret scan, container scan.

## 11. Acceptance criteria (Gate G1)
1. Every seeded role logs in (MFA where required) and sees only permitted navigation and data; matrix test green.
2. Tenant isolation holds at both layers: repository filtering and RLS; cross-tenant FK impossible; queries without tenant context return nothing.
3. Manager cannot access an employee outside their reporting line by guessing an id.
4. Bank, PAN, Aadhaar encrypted at rest, masked by default, unmasked only with permission + step-up, each unmask audited.
5. Every create/update/delete/login/permission change/export is in the audit log with actor, IP, requestId and before/after (secrets redacted); audit table is append-only and partitioned.
6. Session revoke and role change take effect immediately (cache invalidated, tested).
7. Load test thresholds met on 5,000 employees; no Seq Scan on large tables in plan tests; query budgets respected; first-load JS budget met.
8. `pnpm verify` and CI green (including migrations applied to an empty database); fresh clone to running app in under 15 minutes.
9. Docs delivered: README, architecture notes, `.env.example`, local-dev runbook, ADRs, OpenAPI, migration guide (expand/migrate/contract).
