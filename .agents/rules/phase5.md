# AGENTS.md Addendum - Phase 5 (Production Hardening & Go-Live)

## Sources of truth
`docs/PHASE5_SPEC.md`, `docs/PRODUCTION_INFRA_REFERENCE.md`, `docs/GOLIVE_PLAYBOOK.md`, plus all earlier specs and rule files. Feature freeze is in force: only fixes, operability, security, performance and documentation work.

## Production safety (critical)
- You work in the repo and on local/staging environments only. NEVER request, store or use production credentials. NEVER run any command against production. Production changes are made by humans through the reviewed pipeline; you deliver code, playbooks, scripts and runbooks and run them in check/dry-run mode or on staging.
- Destructive commands (rm -rf on data paths, dropping databases/schemas, truncating tables, volume deletion, force push, key deletion) require explicit approval each time, and are never run against anything but disposable local/staging resources.
- Do not invent facts about the owner's infrastructure (hostnames, IPs, bank formats, vendor contracts). Use placeholders, inventories and variables; list what you need.
- Do not fabricate evidence. Drill results, scan reports, pen-test findings, UAT results and sign-offs are produced by real runs and people; you create scripts, templates and report generators and fill reports only from real outputs.

## Infrastructure as code
- Everything reproducible: Ansible roles with idempotence and convergence tests (Molecule or equivalent), configuration tests (goss/testinfra), lint (ansible-lint, yamllint, shellcheck), firewall allow/deny tests, dashboards and alert rules as code, runbooks in `docs/runbooks/` from the template.
- Parameter values in the reference are starting points: verify against current official documentation of the installed versions before encoding them, state the version you verified, and make values variables.
- Secrets never in code, images, logs or CI output; use Vault references. Containers: non-root, read-only filesystem, dropped capabilities, limits, pinned digests, signed.

## Reliability, security, performance
- Every dependency has timeouts, retries with jitter, circuit breaker or bulkhead, a defined degradation behavior (reference section 9), tests, and an alert. Readiness and liveness have distinct meanings; graceful shutdown drains HTTP, SSE and jobs.
- Migrations: expand/contract, `lock_timeout`, concurrent index creation, batched backfills, compatible with the previous app version. Never mix expand and contract in one release.
- Re-verify the performance budgets on production-like hardware and in production through real-user monitoring; no regression of Phase 3 and Phase 4 targets. Static asset caching, compression, HTTP/2 and SSE-safe proxy settings are mandatory.
- Security claims need automated tests (IDOR/authorization attack suite, scanners in CI) and evidence files. Logs and metrics contain no PII, salary, PAN, bank or UAN values.
- Keep DPDP-related behavior configurable (notice and consent versions with timestamps, retention periods, rights-request workflow, breach playbook support); legal text comes from counsel, not from you.
