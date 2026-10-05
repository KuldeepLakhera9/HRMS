# AGENTS addendum for Phase 3 (save as a separate rule file `.agents/rules/phase3.md`; do not merge into AGENTS.md, rule files are limited to 12,000 characters each)

## Sources of truth
`docs/PHASE3_SPEC.md` (leave, holidays, reports, dashboards, pilot) and `docs/DESIGN_SYSTEM.md` (all UI). Earlier phase rules still apply.

## UI and theme
- All colors, radii, shadows, fonts and spacing come from `packages/ui-tokens` (CSS variables on web, typed object on mobile). No hex/rgb literals in components; CI fails on them.
- Follow `docs/DESIGN_SYSTEM.md`: 60-30-10, white content, deep-forest sidebar, leaf green only for active/highlight, status colors only on indicators, Inter via next/font, Lucide icons. Status always has icon + text, never color alone.
- Every new screen must appear in `/dev/design-system` or use only components that do.

## Performance (the app must not lag; measure, do not guess)
- Always measure on a production build (`next build` + `next start`), never on `next dev`. Record before/after numbers for every performance fix in `docs/perf/`.
- Pages fetch data in parallel (Server Components with `Promise.all`, or parallel queries); no request waterfalls. Each dashboard card loads independently inside Suspense.
- Budgets: LCP <= 2.5 s, INP <= 200 ms, first-load JS <= 170 KB gzip per route, API p95 read <= 200 ms / write <= 400 ms, queries per endpoint within the documented budget. These are enforced in CI (Lighthouse CI, bundle budget, query-budget tests, k6 smoke).
- Client components: avoid broad context providers that re-render the tree, memoize heavy lists, virtualize long lists, debounce inputs (250 ms), set TanStack Query `staleTime` and disable `refetchOnWindowFocus` unless justified, one SSE connection per tab (shared).
- Reports and exports never run in a request handler: async job, streamed output, read-only role, mandatory date ranges.

## Leave and balances
- Leave balance is derived from the append-only `leave_ledger`; `leave_balances` is a transactional cache updated in the same transaction. A reconciliation test and job assert `balance == sum(ledger)`.
- Submission locks the balance row (`FOR UPDATE`) and prevents overdraft under concurrency. Overlapping leave is blocked by an `EXCLUDE USING gist` constraint on time ranges, not by application checks alone.
- Day-count logic (half days, sandwich rule, holidays, weekly offs) is a pure, versioned function with a golden-table test. Dates use the employee's location timezone via Luxon.
- Accrual, carry-forward, expiry and comp-off jobs use a `dedupe_key` so reruns never double-credit.
