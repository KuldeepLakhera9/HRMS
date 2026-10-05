# PHASE 3 SPEC (PostgreSQL edition): Stabilize, Leave, Calendars, Reports and Pilot

Prerequisite: Phase 2 gate G2 passed (or at minimum merged and green). Task IDs: `HRMS_Phase_Plan.md` Phase 3 (now with Sprint 3.0). UI: `DESIGN_SYSTEM.md` is binding.
Goal: (1) remove the lag observed in testing, with measured proof; (2) apply the AIC-ADT brand theme across the whole product through design tokens; (3) deliver leave, holidays, calendars, attendance integration, reports v1, role dashboards, announcements and migration tools; (4) run a one-department pilot.

## 0. Out of scope
Payroll, LOP-to-salary use, leave encashment payout, expenses, recruitment, performance, report builder UI, multi-entity, dark theme.

## 1. Fixed decisions
| Topic | Decision |
|---|---|
| Leave arithmetic | Day counts in `numeric` (half day = 0.5), pure versioned function, golden tests |
| Overlap protection | `leave_request_days.period tstzrange` + `EXCLUDE USING gist (company_id WITH =, employee_id WITH =, period WITH &&) WHERE (status IN ('pending','approved'))` (uses `btree_gist`, enabled in Phase 1). Half day = first half local [00:00,12:00) or second half [12:00,24:00); hourly = actual range |
| Balances | `leave_ledger` (append-only, source of truth) + `leave_balances` (transactional cache) |
| Reports | Registry in code, async exports to MinIO, streaming CSV/XLSX, read-only DB role, summary tables for heavy aggregates |
| Dashboards | One endpoint per card, Redis-cached with event invalidation, Suspense streaming |
| Push | FCM provider interface (covers Android and iOS); credentials supplied by the owner; minimal payloads |
| Theme | `DESIGN_SYSTEM.md`, tokens package `packages/ui-tokens`, light theme only |

## 2. Sprint 3.0: Stabilize (performance + theme), do this BEFORE new features
### 2.1 Performance remediation (P3-PERF-01..04)
Principle: **measure first, fix the biggest measured offender, prove the improvement.** The cause of the lag is not yet known; do not guess.
1. **P3-PERF-01 Baseline** (production build only: `next build` + `next start`, containers with realistic resources, repo on a Linux filesystem, not a slow bind mount). Provide `pnpm perf:baseline`, which: seeds 5,000 employees plus attendance data; runs k6 scenarios (login, directory search, profile, attendance today, punch, approvals inbox, notifications, live board); runs Lighthouse CI on key pages (login, home dashboard, directory, profile, attendance, approvals); records SQL statement counts per route; dumps top 20 `pg_stat_statements` by total and mean time; records Redis hit ratio, pg pool waiting count, event-loop lag, bundle sizes (analyzer), and Server-Timing for DB, cache and render. Output `docs/perf/baseline.md` with a ranked offender list.
2. **P3-PERF-02 Diagnose and fix** in measured order. Hypotheses to test (each must be confirmed or ruled out with evidence):
   - Testing in `next dev` or on a slow Docker bind mount (WSL2/macOS volumes): document the dev setup, check Turbopack availability for the installed Next.js version, use `pnpm dev` filters so only needed apps run.
   - Sequential data fetching (request waterfalls) in pages or client components; missing `Promise.all`; client-side fetching of data that could be rendered on the server.
   - Missing indexes, N+1 queries, large JSON payloads, `SELECT *`, unbounded lists, OFFSET pagination, RLS transaction overhead (`set_config` per request) if many tiny transactions occur, pool too small or too large (waiting count), PgBouncer misconfiguration.
   - Session/permission resolution not cached (must be a Redis hit, not a DB read, on every request); middleware doing heavy work; CSP nonce forcing dynamic rendering without data caching.
   - Heavy client bundles (Leaflet, charts, calendar, editors loaded eagerly), fonts and icons imported wholesale, unvirtualized tables, wide context providers re-rendering, TanStack Query refetch storms (`refetchOnWindowFocus`, short `staleTime`), search without debounce, multiple SSE connections per tab or reconnect loops.
   - Argon2 cost applied outside login, synchronous crypto or PDF work in request handlers, event-loop blocking.
   - Auth/MFA pages or dashboards doing sequential calls.
   For every fix record before/after numbers in `docs/perf/report.md`.
3. **P3-PERF-03 Regression guards in CI**: Lighthouse CI budgets, bundle-size budget, query-budget tests, k6 smoke test with thresholds, event-loop lag alert in metrics.
4. **P3-PERF-04 Developer speed**: `docs/dev-performance.md` (recommended local setup, resource limits, Linux filesystem guidance, Turbopack/dev flags, how to profile).
Targets after remediation (production build, 5,000 employees, 200 virtual users): API p95 read <= 200 ms, write <= 400 ms; punch <= 300 ms; LCP <= 2.5 s and INP <= 200 ms on key pages; Lighthouse performance >= 90 desktop / >= 80 mobile emulation; no route above the JS budget; skeleton visible within 100 ms; zero request waterfalls on key pages.

### 2.2 Theme and design system (P3-THEME-01..06)
1. `packages/ui-tokens` with tokens from `DESIGN_SYSTEM.md` (CSS variables + typed TS object for mobile).
2. Tailwind/shadcn mapping, Inter via `next/font`, Lucide icons, radius/shadow/motion tokens.
3. Re-skin every existing screen (auth, shell, sidebar, top bar, dashboards, directory, profile, org, admin, attendance, approvals, geofence editor, notifications) using tokens only; remove hard-coded colors.
4. Status chips, stat cards, tables, forms, dialogs, toasts, skeletons, empty states, charts, calendar cells and the geofence/attendance card per the design system.
5. Mobile app theme from the same tokens (clock screen with the attendance card, status colors, Inter).
6. `/dev/design-system` page, Playwright visual snapshots, automated contrast test over token pairs, CI lint that blocks hex/rgb literals.
Acceptance: no hex literals outside tokens; design-system page matches the spec; contrast test passes except the documented exception; visual snapshots approved by the design owner; dark toggle hidden behind a flag.

## 3. Permission catalog (additions)
```
leave.type.read|manage          leave.policy.read|manage        leave.balance.read (scope)   leave.balance.adjust
leave.request.create (self)     leave.request.read (scope)      leave.request.cancel (self, or HR)
leave.calendar.read (scope)     leave.compoff.claim|manage      holiday.read|manage
report.<key>.run (one per report)   report.schedule.manage      report.export
announcement.read|manage        helpdesk.ticket.create|read|manage
import.leave_balances|import.attendance    featureflag.manage   feedback.create|read   pilot.metrics.read
```
Defaults: employee = leave.request.create/read(self), leave.balance.read(self), calendar(team or company per setting), holiday.read, announcement.read, helpdesk.ticket.create; manager adds read/approve(team), calendar(team), reports for team; hr_manager = all at company scope; accountant = read balances/reports; auditor = read only; super_admin = all.

## 4. Data model
Conventions as before (company_id, composite FKs, RLS forced, base columns, UUIDv7, soft delete where relevant).
| Table | Essentials | Indexes / rules |
|---|---|---|
| leave_types | code, name, is_paid, unit (day/hour), allow_half_day, allow_hourly, requires_document_after_days, max_consecutive_days, min_notice_days, sandwich_rule (none/holidays/weekly_offs/both), allow_negative_balance, negative_limit, applicable_to jsonb (gender, employment_type, min_tenure_days, locations, departments), active | unique (company_id,code) |
| leave_policies | leave_type_id, version, effective_from, period_basis (calendar/fiscal/anniversary), accrual jsonb (frequency monthly/quarterly/yearly/on_joining; amount; pro_rata mode; rounding), carry_forward jsonb (enabled, max_days, expiry_days), max_balance, probation_rule, comp_off jsonb | versioned rows |
| leave_policy_assignments | scope_type (company/department/location/employment_type/employee), scope_id, leave_type_id, policy_id | precedence employee > department > location > employment_type > company; resolved result cached in Redis |
| leave_ledger | employee_id, leave_type_id, period_key, entry_type (opening/accrual/carry_forward/expiry/usage/reversal/adjustment/encashment), delta_days numeric(7,3), effective_date, ref_type, ref_id, reason, meta jsonb, dedupe_key, created_by | **append-only** (trigger, INSERT/SELECT only); unique (company_id,dedupe_key) where not null; (company_id,employee_id,leave_type_id,period_key,effective_date) |
| leave_balances | employee_id, leave_type_id, period_key, opening, accrued, used, adjusted, expired, encashed, pending, closing | unique (company_id,employee_id,leave_type_id,period_key); updated in the same transaction as ledger inserts; invariant closing = opening+accrued+adjusted-used-expired-encashed; available = closing - pending |
| leave_requests | employee_id, leave_type_id, from_date, to_date, from_part, to_part, hours, days numeric, reason, document_file_id, status (pending/approved/rejected/cancelled/withdrawn), workflow_request_id, policy_version, rule_version | (company_id,employee_id,from_date DESC); (company_id,status,created_at DESC) |
| leave_request_days | request_id, employee_id, leave_date, period tstzrange, part (full/first/second/hours), days numeric, status (copy), is_paid | **EXCLUDE** overlap constraint (section 1); (company_id,leave_date,employee_id) for calendar/clash queries; partial on active statuses |
| holiday_lists / holidays | list: name, year, location scope; holiday: list_id, date, name, type (public/optional/restricted) | unique (list_id,date); (company_id,date) |
| holiday_assignments | scope (company/location), list_id | employee list = by location else company |
| comp_off_credits | employee_id, source_date, source_type (weekly_off/holiday/overtime), minutes_worked, days_granted, expires_on, status (granted/used/expired/claimed), ledger_ref | unique (company_id,employee_id,source_date,source_type) |
| attendance_period_summary | employee_id, period 'YYYY-MM', present, absent, half_days, late_count, early_exit_count, weekly_off, holidays, leave_days, od_days, wfh_days, worked_minutes, overtime_minutes, lop_days, computed_at | unique (company_id,employee_id,period); upserted by close_day; reports read this table |
| report_runs | report_key, params jsonb, params_hash, requested_by, status (queued/running/done/failed), rows, file_id, duration_ms, error | (company_id,requested_by,created_at DESC) |
| report_schedules | report_key, params jsonb, cron, timezone, format, recipients jsonb, active, last_run_at | |
| announcements / announcement_reads | title, body (sanitized markdown), audience jsonb (company/department/location/role), publish_at, expire_at, pinned, created_by; reads: announcement_id, user_id, read_at | (company_id,publish_at DESC) where active; unique (announcement_id,user_id) |
| helpdesk_categories / tickets / ticket_comments | category, assignee_role, sla_hours; ticket: requester_id, subject, description, priority, status, assignee_id, due_at | (company_id,status,assignee_id); (company_id,requester_id,created_at DESC) |
| feature_flags | key, scope_type (company/department/user), scope_id, enabled | unique (company_id,key,scope_type,scope_id); cached |
| feedback | user_id, page, rating, message, context jsonb | pilot widget |
| import_jobs (reuse Phase 1 pattern) | type (leave_balances/attendance_history), file_id, status, stats, error_file_id | |
Migrations to existing tables: `attendance_days` add `lop_days numeric(4,2) default 0`, `leave_portion numeric(3,2) default 0`, `holiday_id`; `shifts` add `weekly_off_rules jsonb` (e.g. `[{"day":6,"weeks":[2,4]}]` for 2nd and 4th Saturday off).

## 5. Leave rules and flows
### 5.1 Pure function `computeLeaveDays(input) -> {days[], total, warnings[], violations[]}`
Input: employee, leave type + policy version, from/to + parts, shift/roster/weekly-off rules, holiday list, existing leave. Handles: half day only at start/end of a range, hourly leave (converted to day fraction by the shift's standard minutes), holidays and weekly offs excluded unless the sandwich rule includes them (leave on both sides of a holiday/weekly off => counted), minimum notice, maximum consecutive days, document required after N days, probation and applicability rules, past-date window, overlap with existing leave, balance sufficiency (or negative limit). Versioned (`RULE_VERSION`), deterministic, golden-table tests.
### 5.2 Request flow
1. `POST /leave/preview`: returns day breakdown, balance after, warnings (team clash count against a configurable threshold, holidays inside range), violations (blocking), and the approval route preview (who will approve).
2. `POST /leave/requests` (Idempotency-Key): in one transaction: lock the balance row `FOR UPDATE`, recompute server-side (never trust the preview), insert request + `leave_request_days` (the exclusion constraint blocks overlaps even under concurrency), increase `pending`, start the workflow `leave` (Phase 2 engine; default manager, HR for > N days), outbox event.
3. Approval handler (`onApproved`, idempotent): ledger `usage` entries per day, balance pending -> used, status approved, emit `leave.approved` (attendance recompute for the date range, notifications, calendar cache invalidation).
4. `onRejected`/withdraw/cancel before approval: release pending, status update. Cancel after approval (future or within window): `reversal` ledger entries; past dates beyond the window need HR workflow.
5. Edit = cancel + new request (keeps history clean).
### 5.3 Accrual, carry-forward, comp-off
- `leave.accrual` (monthly/quarterly/yearly/on_joining, per company timezone, plus daily catch-up for new joiners): ledger `accrual` with `dedupe_key = accrual:{employee}:{type}:{period}`; pro-rata for mid-period joiners with policy rounding (0.5).
- `leave.period_end`: carry-forward up to max, expiry entries, new period opening entries (dedupe keys).
- Comp-off: on `attendance.day_closed`, if worked on weekly off/holiday for at least the policy minutes (half/full), create `comp_off_credits` + ledger credit (mode `auto`) or allow a claim through the workflow (mode `claim`); expiry job. Optional holidays: employee selects up to the yearly quota (Could).
- Late-mark penalty (policy rule, e.g. 3 late marks = half day): month job creates `usage` ledger entries (ref_type `late_penalty`, dedupe key) from the configured leave type; if balance is insufficient, record `attendance_days.lop_days` instead (consumed by payroll in Phase 4).
- Manual balance adjustment: HR only, reason mandatory, step-up, audited, ledger `adjustment`.
- Reconciliation job and test: `leave_balances` must equal ledger sums; discrepancies alert.

## 6. Holidays, weekly offs, calendars
Holiday lists per location (or company), weekly-off rules including alternate Saturdays, holiday import from CSV. Calendar endpoints:
`GET /leave/calendar?from&to&scope=me|team|department|company` returns per-day aggregates and (permission/privacy permitting) names; peers see "on leave" only if the company setting allows, leave type names visible to manager/HR. Uses `leave_request_days` date-range indexes; query budget <= 3; cached 60 s per scope+range with event invalidation. Team clash check for `preview` uses the same index.

## 7. Attendance integration (real DayContextProvider)
Replace the Phase 2 stub: approved leave (full/half/hourly), holidays, weekly-off rules, OD/WFH. Engine `RULE_VERSION` bump; statuses L, H, WO, OD, WFH; half-day leave + half-day present = present with `leave_portion`; leave approve/cancel and holiday/roster changes trigger `attendance.recompute_day` for the affected employees and range (batched). Locked periods stay locked. Day close also upserts `attendance_period_summary`.

## 8. Reports v1 (framework + 8 reports)
Framework: registry `{key, title, permission, filtersSchema (Zod), columns, builder (SQL on summary tables/read role), scopes, exports[]}`. Mandatory date range, max range per report, scope applied by permission (`team`/`department`/`company`). Sync preview (paged JSON, <= 5,000 rows); async export (`report.export` job): streamed CSV (`COPY ... TO STDOUT` or cursor) and XLSX (streaming writer), file stored in MinIO, notification with a short-lived link; scheduled reports (cron, recipients, format) via `report_schedules`; run history in `report_runs`; heavy queries use the read-only role (`READ_DATABASE_URL` if a replica exists) with a longer `statement_timeout`; row/size limits; audit entries for exports; restricted reports (coordinates, selfies) need `attendance.location_data.view`.
Reports: (1) attendance summary per employee/period, (2) daily attendance register (employee x day), (3) late/absent/early exit list, (4) attendance exceptions, (5) leave balances, (6) leave usage (type/department/month), (7) headcount (department/location/type/status), (8) joiners and leavers.

## 9. Dashboards (P3-DASH-01)
Each card has its own endpoint `GET /dashboard/cards/:key`, own permission check, Redis cache (30-120 s) with event invalidation, query budget <= 2, rendered in its own Suspense boundary with skeleton.
- Employee: today status + Clock card (design-system attendance card), leave balances, next 3 holidays, pending requests, announcements, birthdays/anniversaries this week (day and month only, opt-out supported).
- Manager: team in/out today, pending approvals, team on leave this week, late/exception list, upcoming leave.
- HR: headcount, joiners/leavers this month, attendance rate today, exceptions count, pending approvals, 6-month leave trend, document expiries (30 days).
- Admin: failed jobs, login failure spikes, audit highlights, queue depth.
Charts follow the design system (green palette, labels, table fallback).

## 10. Notifications, announcements, helpdesk-lite
- Push via the FCM provider interface (credentials owner-supplied, minimal payloads: type + id + short generic text); daily approvals digest email for managers (cron per timezone); preferences per type/channel respected.
- Announcements: sanitized markdown (no raw HTML), audience targeting, schedule/expiry, pinned, read receipts (optional), attachments via files flow.
- Helpdesk-lite: categories with default assignee role and SLA, tickets with comments, status flow open -> in_progress -> resolved -> closed, notifications, SLA due indicators (full helpdesk later).
- Directory polish: filters, saved views, birthdays/anniversaries widget.

## 11. Data migration tools (P3-MIG-01)
Phase 1 import pattern (upload, background validate, preview with row errors, confirm, error CSV, idempotent batches):
- Opening leave balances: `emp_code, leave_type, period, balance` -> ledger `opening` entries with dedupe keys.
- Historical attendance: `emp_code, date, in, out, status` -> punches with `source=import` (flagged) and recompute, plus a reconciliation report. Imports are audited and can be reverted per job (reversal entries / soft-delete of imported punches).

## 12. Pilot enablement (P3-PILOT-01)
- Feature flags enable modules per department/user for the pilot; rollback = flip flags.
- In-app feedback widget (rating + message + page context), support playbook, training guide, quick-start cards, weekly review template.
- **Pilot metrics page** (permission `pilot.metrics.read`): adoption (share of pilot employees with a punch each day), app vs web ratio, punch failure rate by reason code, regularization rate, approval turnaround (median, p90), leave requests, error rate, p95 latency, support tickets. Data from existing tables + metrics, cached.
- Pilot plan: choose department, communication, training sessions, success criteria, go/no-go meeting after 4 weeks.

## 13. Web and mobile UI
All screens follow `DESIGN_SYSTEM.md`.
- Leave: apply-leave form with live preview (balance after, holidays, clash warning, approval route), date-range selection with half-day toggles, balances page (cards per leave type), my requests with timeline, team/department/company calendar (day cells with status chips, drawer details), admin screens for types, policies, assignments, holiday lists, balance adjustments, comp-off.
- Reports: catalog page, filter form, preview table, export button with progress and notification, schedules management, run history.
- Dashboards per role, announcements feed and admin, helpdesk tickets, pilot metrics, feedback widget.
- Mobile: leave apply and balances, approvals for managers, calendar, holidays, announcements; theme from tokens; push notifications.
Everything has skeleton/empty/error states, keyboard accessibility, and live updates (SSE) where useful.

## 14. Observability
Metrics: leave submissions, preview latency, balance lock wait time, accrual job duration and counts, report run durations and failures, dashboard card latency and cache hit ratio, calendar cache hit ratio, push delivery results, import errors. Alerts: ledger/balance mismatch, report failure spikes, accrual job failure, event-loop lag.

## 15. Testing requirements
- **Leave day golden table (>= 40 cases)**: full/half/hourly, start/end half days, holidays, weekly offs (including alternate Saturdays), sandwich rule variants, notice, max consecutive, document rule, probation, gender/applicability, past window, negative balance limit, year boundary, pro-rata joiners, rounding.
- **Concurrency**: 20 parallel requests that together exceed the balance => only the allowed ones succeed; overlapping requests blocked by the exclusion constraint; parallel approve/cancel idempotent.
- **Ledger invariants**: balance equals ledger sum after every operation (property-style test with random sequences); accrual/period-end reruns do not double credit; append-only trigger.
- **Attendance integration**: leave approval/cancel recomputes days; half-day leave + presence; holiday and roster changes recompute; locked periods unaffected; recompute idempotent.
- **Reports**: each report against a seeded dataset with known expected numbers; scope/permission enforcement (manager only team); async export of 100k rows within memory limits (streamed), cancellation and failure handling; scheduled run test with a fake clock.
- **Dashboards/calendar**: query budgets (card <= 2, calendar <= 3, preview <= 6, submit <= 12), cache invalidation on events, plan tests (no Seq Scan at scale).
- **Security**: RLS/composite-FK tests for every new table, IDOR (employees cannot see others' leave details; managers only team), permission matrix extended, sanitized announcements (XSS tests), import abuse tests, report exports audited.
- **E2E (Playwright)**: apply/approve/cancel leave, clash warning, calendar views, report export, announcement, ticket, role dashboards, feedback widget, feature-flag gating. **Mobile (Maestro)**: leave apply, approval, push deep link.
- **Performance gates**: re-run `pnpm perf:baseline`; compare with the Sprint 3.0 report; k6 morning spike (2,000 punches/10 min) while 300 users load dashboards and calendar: punch p95 <= 300 ms, reads <= 200 ms, errors < 1%.
- **Accessibility**: axe on key pages + manual keyboard/screen-reader pass; contrast test; visual snapshots of the design-system page.
- **UAT**: scripted scenarios with real HR rules (leave policies, sandwich, comp-off, holiday list, reports vs current spreadsheets).

## 16. Acceptance criteria (Gate G3)
1. Sprint 3.0: documented before/after performance report; budgets met on the production build; CI guards active; the reported lag is explained (root cause stated) and fixed, or remaining items are listed with owners.
2. Theme: whole product uses tokens only; design-system page and snapshots approved; contrast test passes except the documented exception; mobile matches the web theme.
3. Leave balance always equals ledger sums under concurrency; overdraft and overlap impossible; golden tables 100% green.
4. Leave approval, cancellation, holidays and roster changes update attendance days correctly and idempotently.
5. Calendars, dashboards and reports meet query budgets and latency targets on 5,000 employees; exports stream within memory limits and are audited.
6. Role dashboards show correct numbers (verified against seed data) and load independently.
7. Migration imports reconcile with source files and are revertable.
8. Pilot department live for 4 weeks: >= 90% of punches via the app, no open critical/high bugs, feedback reviewed, HR sign-off.
9. `pnpm verify` and CI green; docs, runbooks (accrual failure, report failure, ledger mismatch, rollback via feature flags), OpenAPI updated.
