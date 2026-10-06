# AGENTS addendum for Phase 4 (save as a separate rule file `.agents/rules/phase4.md`; each rule file must stay under 12,000 characters)

## Sources of truth
`docs/PHASE4_SPEC.md`, `docs/CA_VALIDATION_KIT.md`, `docs/DESIGN_SYSTEM.md`, plus all earlier specs and rule files.

## Statutory data and tests (critical)
- NEVER invent or "remember" statutory rates, ceilings, slabs, thresholds, due dates, file layouts or form numbers. They are rule data entered by the owner/CA. Seed rule sets are `draft` + `CA_VERIFY`; production activation is blocked until a checker approves them. If the official EPFO/ESIC/Income Tax format is needed, fetch it from the official source and cite it; if unavailable, mark the output `UNVERIFIED` and say so.
- Expected values in golden tests come ONLY from `tests/golden/payroll/*.json` supplied by the CA/Finance. Never derive expected numbers by running your own implementation. Synthetic tests use rule sets named `TEST_*` and must be obviously fake.
- Rules are data, engines are pure: `computePayslip`, `computeTds`, `computeLeaveDays`-style functions take everything as input (no DB, no clock, no randomness) and are versioned (`ENGINE_VERSION`).

## Money and formulas
- Money: `numeric(14,2)` in the database, `decimal.js`/bigint in code, explicit rounding per component. No JS floats for money. Format with `Intl` en-IN; tabular numerals; negatives in parentheses on payslips.
- Formulas run only through the custom safe evaluator (whitelisted functions, size/depth/time limits, cycle detection). Never `eval`, `Function`, or a general-purpose expression library with property access.

## Immutability and control
- Payslips, payslip lines, tds_computations, run events and audit logs are immutable (trigger-enforced). Locked runs never change; corrections are off-cycle/correction runs or adjustments.
- All state transitions go through one guarded function with a row lock and precondition checks. Enforce segregation of duties (creator != approver != locker; maker != checker) and step-up auth for salary view, approvals, bank files, unlock.
- Exactly-once effects (input consumed, claim paid, installment recovered, ledger/YTD update) use unique keys and idempotent upserts; test with crash/resume and parallel attempts.

## Performance and safety
- Calculation: bulk-load per chunk (<= 8 queries), compute in pure functions, write in chunks; no per-employee queries; skip unchanged `input_hash`. Never run payroll, PDF generation or exports in request handlers. PDFs via a pure-JS renderer (benchmark and record an ADR), not headless Chromium for bulk.
- Payroll files (bank, statutory) are private, encrypted at rest, one-time signed URLs, every download audited. No salary, PAN, bank or UAN values in logs, metrics or error messages.
- UI, PDFs and emails follow `docs/DESIGN_SYSTEM.md` (tokens only). Labels for tax forms come from rule data (`FORM_LABELS`), not hard-coded strings.
