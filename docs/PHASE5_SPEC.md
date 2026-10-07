# PHASE 5 SPEC (PostgreSQL edition): Hardening and Production Go-live

Companions: `PRODUCTION_INFRA_REFERENCE.md` (topology, sizing, firewall, configuration guidance, alerts, runbook index), `GOLIVE_PLAYBOOK.md` (people, UAT, migration, training, legal, cutover, hypercare, handover), `DESIGN_SYSTEM.md`, all earlier specs and rule files.
Prerequisite: Phase 4 code merged and green. Parallel payroll cycles may still be running (Phase 4 gate G4 is a go-live prerequisite, not a start prerequisite). **Sprint 5.1 (infrastructure) should start during Phase 4**, because hardware, network and certificate lead times are the usual cause of go-live delays.
Goal: make the platform safe, recoverable, observable and fast on production infrastructure; migrate real data; prove it with drills and UAT; go live; stabilize; hand over to steady operations.

## 0. Principles
1. **Prove, do not assume.** Every resilience, security and performance claim needs evidence (drill report, test output, metric screenshot) stored in `docs/evidence/phase5/`.
2. **Production is touched only by humans through a reviewed pipeline.** The AI agent writes code, infrastructure-as-code, scripts, dashboards, alert rules, runbooks and tests, and runs them against local/staging environments only. It never receives production credentials and never runs commands against production.
3. **Everything is reproducible.** Servers, configs, dashboards and alert rules come from version-controlled code (Ansible, compose files, Prometheus rules, Grafana JSON). No manual snowflake changes; emergency manual changes are recorded and back-ported.
4. **Fail safe and degrade gracefully.** Each dependency has a defined degradation behavior (see reference, section 9), timeouts, retries with backoff, and alerts.
5. **Staging mirrors production** (topology, versions, TLS, network rules, HA). If staging is not production-like, drill results do not count.
6. **Real data = real protection.** Dry-run migrations with real personal data happen in an environment protected like production (access, encryption, audit), then are wiped or promoted.
7. **Speed is a feature.** The performance budgets from Phase 3 and Phase 4 are re-verified on production hardware, from real client networks (office LAN, mobile data), and watched in production through real-user monitoring.

## 1. Scope
In: production infrastructure build and hardening; CI/CD deployment engineering; observability, alerting, synthetic and real-user monitoring; security program (scanning, hardening, pen test, remediation, key custody, access governance, audit integrity); reliability program (SLOs, load/soak/spike, failover, chaos, backup restore, disaster recovery); application hardening (degraded modes, timeouts, graceful shutdown, maintenance mode); production data migration; UAT; accessibility audit; training; privacy and legal readiness; cutover; first live payroll; hypercare; handover to BAU.
Out: new product features (feature freeze starts at the beginning of Phase 5; only fixes and operability work), multi-region active-active, Kubernetes migration (optional later), multi-company hosting.

## 2. Who does what (be explicit)
| Activity | AI agent (in repo, staging only) | Humans |
|---|---|---|
| Servers, VMs, racks, power, network, ISP, public IP, certificates | Writes Ansible roles, VM/OS baselines, firewall rule sets, certificate automation, checks | Provision hardware/VMs, cabling, ISP, DNS, procure certificates or run the internal CA, approve firewall changes |
| Database HA, backups | Writes Patroni/etcd/HAProxy/PgBouncer/pgBackRest configuration code, restore automation, verification scripts | Provide hardware/storage, offsite target, run and sign drills |
| Monitoring | Dashboards, alert rules, exporters, synthetic probes, RUM endpoint | Define on-call rota, receive and act on alerts, own thresholds |
| Security | Scanners in CI, hardening code, IDOR/automated attack suites, fixes, evidence | Commission external pen test, triage findings, accept risk, custody of keys |
| Performance/reliability | Load/soak/chaos scripts, tuning changes, reports | Run drills on real infrastructure, approve downtime windows |
| Migration | Importers, validators, reconciliation reports, rollback scripts | Source data, cleansing decisions, sign-off, execute final migration |
| UAT, training, legal | Test scripts, training material drafts, in-app tours, policy drafts | Execute UAT, deliver training, legal review and approval |
| Go-live | Cutover scripts, smoke tests, dashboards, runbooks | Go/no-go decision, cutover execution, hypercare staffing |

## 3. Fixed decisions (record each as an ADR; change only with a new ADR)
| Topic | Decision |
|---|---|
| Orchestration | Docker Compose per node + systemd, Ansible-managed, rolling deploys behind the load balancer (k3s remains optional later) |
| Load balancing / edge | 2 Nginx nodes with keepalived virtual IP; WAF (ModSecurity or Coraza with OWASP CRS); rate limiting; TLS termination; HTTP/2 |
| PostgreSQL HA | Patroni + etcd (3 nodes) + HAProxy; 1 primary + 2 replicas; `synchronous_mode` on with one synchronous standby; PgBouncer (transaction mode) next to the apps; pgBackRest with WAL archiving to two repositories (local backup server + offsite, encrypted) |
| Redis | Primary + replica with 3 Sentinels, AOF persistence; application degrades gracefully if Redis is unavailable |
| Object storage | MinIO distributed (erasure coded, 4 nodes) or the storage decision from ADR-004, with versioning and object lock (WORM) for payroll/statutory files, replicated offsite. Re-verify MinIO's current license and distribution terms before final selection |
| Secrets and keys | Vault (or OpenBao) with Shamir-split unseal custody; field-encryption keys with documented custody, rotation and recovery ceremony |
| Disk encryption | LUKS on all data volumes (database, object storage, backups, logs) with documented unlock procedure |
| Admin access | VPN (WireGuard) + bastion, SSH keys only, MFA, session recording/logging, just-in-time elevated access, break-glass accounts sealed and audited |
| Egress | Default-deny outbound; allow-listed forward proxy for push (FCM/APNs), attestation (Google APIs), package mirrors, SMTP relay, ACME if used |
| DR model | Start with **cold restore from offsite backups** (target RTO 4 to 8 h, RPO <= 15 min), with a documented path to a warm standby site (RTO <= 1 h) as a later option |
| RUM | Self-hosted web-vitals collection (LCP, INP, CLS, TTFB, route, device class) into Prometheus/Loki, no third-party analytics |

## 4. Workstreams and tasks
IDs: `P5-<AREA>-nn`. Sprint mapping in section 8.
### 4.1 Infrastructure build (P5-INFRA)
| ID | Task |
|---|---|
| P5-INFRA-01 | Environment inventory and naming: dev, staging, production; hosts, roles, IPs, VLANs, DNS names; diagrams as code (Mermaid/PlantUML in `docs/infra/`) |
| P5-INFRA-02 | Ansible repository: inventories per environment, roles (base-hardening, docker, nginx-edge, app-node, worker-node, postgres-patroni, etcd, haproxy, pgbouncer, redis-sentinel, minio, vault, monitoring, backup, bastion, vpn), idempotent, tested with Molecule or an equivalent on VMs/containers |
| P5-INFRA-03 | OS baseline: minimal install, unattended security updates, SSH hardening, auditd, chrony, nftables default-deny, kernel/sysctl tuning, file system layout and permissions, fail2ban, LUKS, log forwarding; CIS-benchmark-style checklist with automated checks |
| P5-INFRA-04 | Network: VLANs per tier, firewall rule matrix as code, bastion/VPN, DNS, internal CA or ACME automation, egress proxy, NTP, time-drift alerts |
| P5-INFRA-05 | Edge: Nginx pair + keepalived, WAF with tuned rules, TLS (modern ciphers, HSTS), HTTP/2, compression, immutable caching for static assets, SSE-safe proxy settings (no buffering, long read timeout), rate limits, request size limits, upstream health checks |
| P5-INFRA-06 | App tier: hardened container images (non-root, read-only filesystem, dropped capabilities, resource limits, pinned digests), compose files, systemd units, health checks, log drivers, config from Vault/agent not from images |
| P5-INFRA-07 | PostgreSQL HA: Patroni, etcd, HAProxy, PgBouncer, parameter tuning, roles and privileges, extensions (PostGIS, pg_trgm, citext, btree_gist, pg_stat_statements), monitoring exporter, upgrade procedure |
| P5-INFRA-08 | Backups: pgBackRest schedules (weekly full, daily differential, continuous WAL), encryption, two repositories, retention, object-storage backup/replication, Vault and config backups, automated restore verification |
| P5-INFRA-09 | Redis Sentinel, MinIO distributed, Vault HA; secrets bootstrap and rotation procedures |
| P5-INFRA-10 | CI/CD to production: signed images, registry scanning, staging deploy, automated smoke tests, manual approval gate, rolling deploy with drain and health checks, automatic rollback, migration job with `lock_timeout` and expand/contract rules |
| P5-INFRA-11 | Capacity plan and scale-out triggers documented; cost and licensing register |
| P5-INFRA-12 | Physical and colocation checklist completed and evidenced (power, UPS/generator tests, cooling, access control and logs, labeling, spares, support contracts) |
### 4.2 Observability and operations (P5-OBS / P5-OPS)
| ID | Task |
|---|---|
| P5-OBS-01 | Prometheus, Alertmanager, Grafana, Loki (+ Promtail/Alloy), exporters (node, postgres, pgbouncer, redis, minio, nginx, blackbox), all provisioned as code |
| P5-OBS-02 | Dashboards as code: edge, app (RED metrics per route), database, pooler, Redis, queues, storage, business (punch success by reason, payroll run progress, report queue), security, backup status, SLO burn |
| P5-OBS-03 | Alert rules from the reference list, each with severity, owner, runbook link, and a firing test in staging |
| P5-OBS-04 | Synthetic probes (inside and outside the data center): login flow, punch API with a test employee, payslip fetch, mobile `/app/config`, TLS expiry |
| P5-OBS-05 | Real-user monitoring: web-vitals collector, mobile app timings, per-route p75/p95 dashboards, alert on regression |
| P5-OBS-06 | Log hygiene: structured logs, retention policy, PII/salary scrubbing tests, audit log export to WORM storage on a schedule with hash chain |
| P5-OPS-01 | Runbooks (index in reference, section 10) written from the template, each rehearsed or peer-reviewed |
| P5-OPS-02 | On-call and escalation: rota, severity matrix, contact tree, alert routing (email/SMS/chat), maintenance windows, change calendar, status page for staff |
| P5-OPS-03 | Incident management: process, templates, post-mortem format, communication templates, security incident and personal-data-breach playbook |
### 4.3 Application hardening (P5-APP)
| ID | Task |
|---|---|
| P5-APP-01 | Timeouts, retries with jitter, circuit breakers and bulkheads for Redis, MinIO, SMTP, push, attestation, replica reads; degradation behavior implemented and tested (reference section 9) |
| P5-APP-02 | Readiness vs liveness correct semantics; graceful shutdown (drain HTTP, SSE, jobs; finish or re-queue in-flight work); worker crash-safety verified |
| P5-APP-03 | Maintenance mode (static page, read-only mode switch, API 503 with Retry-After), feature flags for risky functions |
| P5-APP-04 | Rate-limit and abuse tuning from real traffic shapes; per-tenant/user quotas for exports and uploads |
| P5-APP-05 | Database connection management under PgBouncer (pool sizes, no session state, prepared statement setting), query timeouts, idle-in-transaction guard, safe migration tooling (`lock_timeout`, concurrent index creation, batched backfills) |
| P5-APP-06 | Asset and rendering performance in production: immutable caching, compression, HTTP/2, `output: standalone` tuning, memory limits, multiple instances per node by CPU, RUM-driven fixes |
| P5-APP-07 | Mobile hardening: certificate pinning decision (document trade-offs), forced-update flow tested, offline queue limits, crash reporting self-hosted (GlitchTip/Sentry) |
### 4.4 Security program (P5-SEC)
| ID | Task |
|---|---|
| P5-SEC-01 | Supply chain: SBOM (CycloneDX), dependency audit, license check, image scanning (Trivy/Grype), image signing (cosign), pinned digests, automated dependency updates (self-hosted Renovate), `gitleaks` in CI and history |
| P5-SEC-02 | SAST (Semgrep OSS rules for TypeScript/Next.js) and DAST (OWASP ZAP baseline + authenticated scan) in CI against staging; findings triaged and tracked |
| P5-SEC-03 | OWASP ASVS (current version) Level 2 verification matrix: each requirement marked pass/fail/not applicable with evidence |
| P5-SEC-04 | Automated authorization attack suite: every route x every role x foreign ids (IDOR), mass assignment (strict Zod), forced browsing, tenant crossing, step-up bypass, MFA bypass, session fixation/replay, refresh reuse, CSRF/Origin, upload abuse (polyglot, zip bomb, SVG disallowed), SSRF (no user-supplied URL fetches), injection (raw SQL lint, parameterization), ReDoS, log injection, CORS |
| P5-SEC-05 | External penetration test: scope, rules of engagement, test accounts per role, staging environment mirror, retest after fixes; zero open critical/high at go-live; accepted risks recorded with owner and expiry |
| P5-SEC-06 | Secrets and keys: rotation of DB passwords/JWT/session keys/API keys exercised in staging; field-encryption key custody ceremony (split custody, sealed backups, recovery drill, re-encryption job run) |
| P5-SEC-07 | Access governance: privileged access inventory, JIT admin, break-glass procedure, quarterly access review process, database role privilege audit (app cannot UPDATE/DELETE append-only tables, cannot bypass RLS, no DDL), service accounts least privilege |
| P5-SEC-08 | Detection: alerts for failed-login spikes, MFA failures, role/permission changes outside change windows, mass exports, salary-view anomalies, new admin creation, WAF block spikes, Vault access anomalies |
| P5-SEC-09 | Audit log integrity: periodic signed/hash-chained export to WORM storage; verification job; retention enforced |
| P5-SEC-10 | Email authentication for the sending domain (SPF, DKIM, DMARC), outbound mail relay hardening |
### 4.5 Reliability and performance (P5-REL)
| ID | Task |
|---|---|
| P5-REL-01 | Define SLOs and error budgets (reference section 8) and publish SLO dashboards |
| P5-REL-02 | Load test at 2x expected peak on production hardware (punch spike, dashboards, calendar, reports, payroll run concurrently), from the office network and a mobile-data path |
| P5-REL-03 | Soak test (24 h at 50% load) for leaks, bloat, queue growth, pool behavior; spike test (10x for 2 minutes); connection storm test |
| P5-REL-04 | Failover and chaos drills (reference section 7) with measured recovery times and data-loss checks |
| P5-REL-05 | Backup restore drills: PITR to a chosen timestamp, full restore on clean hardware, verification of payslip integrity hashes and run hashes, ledger/YTD reconciliation after restore |
| P5-REL-06 | Disaster recovery drill (site loss simulation) with timing against RTO/RPO; documented gaps and fixes |
| P5-REL-07 | Database health review: unused/duplicate indexes, bloat, autovacuum tuning, long-running queries, top `pg_stat_statements`, partition maintenance verified, XID age monitoring |
| P5-REL-08 | Zero-downtime deployment verification: deploy and roll back under load with no failed requests beyond budget; migration under load |
### 4.6 Data migration (P5-DATA) (see playbook section 3)
| ID | Task |
|---|---|
| P5-DATA-01 | Source inventory and mapping specification per dataset (employees, org, bank/ID data, salary, leave balances, attendance history, documents, YTD payroll, declarations, loans) |
| P5-DATA-02 | Cleansing report and rules (duplicates, invalid PAN/IFSC/dates/emails, missing mandatory fields, inconsistent hierarchy) with data-owner decisions |
| P5-DATA-03 | Importers and validators for each dataset (idempotent, revertable, audited) building on Phase 1/3/4 import tooling; document migration (scans) with checksum manifest |
| P5-DATA-04 | Three dry runs on production-like staging with reconciliation reports (counts, sums, referential checks, spot-check samples) and timing; exit criteria in the playbook |
| P5-DATA-05 | Final cutover migration script, delta migration procedure, post-migration verification queries, rollback via snapshot/PITR point |
| P5-DATA-06 | User provisioning in waves: invites, MFA enrollment sessions, device registration for mobile, geofence defaults |
### 4.7 Quality, accessibility, training, legal, cutover (P5-UAT / A11Y / TRAIN / LEGAL / CUT / PAY / HYPER)
| ID | Task |
|---|---|
| P5-UAT-01 | UAT plan, scenario scripts per role and module with expected results, defect severity rules, entry/exit criteria (playbook section 4) |
| P5-UAT-02 | Execute UAT with HR, Finance, managers and employees; triage; fix; regression; sign-off |
| P5-A11Y-01 | Accessibility audit (WCAG 2.1 AA): automated (axe) + manual keyboard + screen reader (NVDA) on critical flows; contrast report; fixes |
| P5-A11Y-02 | Browser and device matrix testing (Chrome, Edge, Firefox, Safari; Android and iOS versions in use) incl. mobile field-test results |
| P5-TRAIN-01 | Role-based training: employee, manager, HR, finance, admin; guides, short videos, in-app tours, FAQ, champions network, office hours (playbook section 6) |
| P5-LEGAL-01 | Privacy and legal readiness: DPDP-aligned notice and consent text (location, selfie), retention schedule configured, rights-request process, breach playbook, processor list, monitoring policy, grievance contact; counsel sign-off (playbook section 7) |
| P5-CUT-01 | Cutover plan and scripts, freeze, rollback criteria, comms (playbook section 8, 11) |
| P5-CUT-02 | Go/no-go dossier and meeting (checklist in playbook section 13) |
| P5-PAY-01 | First live payroll protocol with Finance and CA on standby (playbook section 9; CA kit rules) |
| P5-HYPER-01 | Hypercare operation (2 to 4 weeks): war room, fast-fix lane, daily health review, KPIs |
| P5-HYPER-02 | Handover to steady operations: ownership, SLAs, maintenance calendar, drill schedule, backlog (playbook section 12) |

## 5. Detailed requirements for key areas
### 5.1 Edge and delivery (performance-critical)
- HTTP/2 enabled; Brotli or gzip for text; `Cache-Control: public, max-age=31536000, immutable` for hashed static assets; short or no cache for HTML and API; ETag support; keepalive to upstreams; connection reuse; TLS session resumption; OCSP stapling if public CA.
- **SSE/real-time routes**: `proxy_http_version 1.1`, `proxy_buffering off`, `proxy_cache off`, `proxy_read_timeout` long (for example 1 hour), heartbeat comments every 15-25 s from the app, client reconnect with jitter, one SSE connection per tab (shared worker or BroadcastChannel).
- Request limits: body size per route class, header size, slowloris protection (timeouts), per-IP and per-user rate limits (login, punch, export, upload) with sensible burst; WAF in detection mode first, then blocking after tuning against UAT traffic.
- Maintenance page served by Nginx without the app. Health endpoints not exposed publicly except a minimal check.
### 5.2 Application behavior under failure
Implement and test the degradation matrix (reference section 9). Principles: auth keeps working if Redis is down (fall back to Postgres at reduced speed), writes never silently dropped, punches queued client-side when the API is unreachable, notification channels fail independently, exports and PDFs queue and retry, no cascading timeouts (bulkheads), clear user-facing messages, and every degraded mode raises an alert.
### 5.3 Database operations
Parameter guidance, Patroni behavior, backup policy, restore verification and upgrade procedure are in the reference. Requirements: failover automatic with no committed-data loss on single-node failure (synchronous standby); applications reconnect within 30 s without restart (PgBouncer/HAProxy health logic); restore drills are scripted and timed; migrations use `lock_timeout`, run through the owner role, are backward compatible with version N-1 of the app, and large backfills run in batches with progress and pause/resume.
### 5.4 Release engineering
Pipeline: build -> unit/integration -> SAST/SBOM/image scan -> sign -> deploy staging -> smoke + e2e + ZAP baseline -> manual approval -> rolling production deploy (drain, health check, next node) -> post-deploy smoke -> automatic rollback on failed health or elevated error rate. Hotfix lane: same pipeline with reduced test set that still includes security and critical-flow tests; every hotfix gets a regression test within 48 hours. Release notes and a change record for each production deploy. Deploy freeze windows around payroll lock, bank file generation and statutory due dates.
### 5.5 Evidence pack
`docs/evidence/phase5/` with: architecture diagrams, firewall matrix, scan reports, ASVS matrix, pen-test report and retest, load/soak/spike reports, drill reports (failover, restore, DR) with timings, migration dry-run reports, UAT results, accessibility reports, training attendance, legal sign-offs, go/no-go minutes, cutover log, hypercare reports.

## 6. Performance acceptance on production hardware
Re-run `pnpm perf:baseline` plus the Phase 4 payroll scenarios on production hardware (before real data is loaded, using the synthetic 5,000-employee seed): API p95 read <= 200 ms, write <= 400 ms, punch <= 300 ms; LCP <= 2.5 s and INP <= 200 ms measured by RUM and Lighthouse from the office network and a mobile data connection; payroll calculation <= 5 min, lock <= 3 min, 5,000 PDFs <= 6 min per worker; no SLO regression while payroll runs. Compare with `docs/perf/` and record.

## 7. Testing and verification requirements
- Infrastructure code: lint (ansible-lint, yamllint, shellcheck), Molecule or VM-based convergence and idempotence tests, configuration tests (testinfra/goss) for hardening rules, firewall rule tests (allowed and denied paths), certificate expiry tests.
- Deployment: rolling deploy and rollback under k6 load with error budget; migration under load; blue/green switch rehearsal.
- Failover drills (all with k6 background load and a data-integrity probe that writes and reads known records): primary DB kill, replica kill, etcd node loss, Patroni switchover and failover, HAProxy/PgBouncer restart, Redis primary kill, MinIO node loss, app node loss, edge node loss (VIP move), network partition between app and DB, disk-full simulation, Vault sealed, DNS failure, clock skew, certificate expiry simulation, worker crash during payroll calculation and locking, SMTP/FCM outage.
- Backup/restore: PITR drills to a timestamp between two known writes, full restore to clean hosts, verification script (row counts, referential checks, payslip integrity hashes, run hashes, ledger/YTD reconciliation), object-store restore and checksum verification.
- Security: all items in P5-SEC with reports; pen-test retest evidence; secrets rotation drill evidence; privilege audit script output.
- Observability: every alert fired deliberately in staging and routed to the on-call channel; dashboards reviewed with operations; synthetic probes verified by breaking the monitored flow.
- Migration: three dry runs with reconciliation; rollback rehearsal; timing within the cutover window.
- UAT and accessibility: executed scripts with results, defect log, sign-offs, accessibility reports.
- Privacy: retention jobs verified, consent records stored with version and timestamp, rights-request workflow tested, breach playbook table-top exercise held and minuted.

## 8. Sprint plan (mapped to the Phase Plan)
| Sprint | Focus | Output |
|---|---|---|
| 5.1 | INFRA-01..12 (can start during Phase 4) | Production-like environment built from code; staging mirrors it; HA verified at a basic level |
| 5.2 | OBS-01..06, OPS-01..03, APP-01..07 | Monitoring, alerts, runbooks, degraded modes, safe deploys |
| 5.3 | SEC-01..10 | Scans, hardening, ASVS matrix, pen test run and fixes, key custody and access governance, DPDP technical measures |
| 5.4 | REL-01..08, performance acceptance | Load, soak, spike, failover, restore and DR drills with reports and fixes |
| 5.5 | DATA-01..06, UAT-01/02, A11Y-01/02, TRAIN-01, LEGAL-01 | Migration dry runs, UAT sign-off, accessibility, training and legal readiness |
| 5.6 | CUT-01/02, PAY-01, HYPER-01/02 | Go/no-go, cutover, first payroll, hypercare, handover, Gate G5 report |

## 9. Acceptance criteria (Gate G5; expanded checklist in `GOLIVE_PLAYBOOK.md` section 13)
1. Production environment is built entirely from code; a rebuild of a failed node completes within the documented time; staging mirrors production.
2. Database HA: automatic failover with zero committed-data loss (single failure) verified under load; applications recover within 30 s; PITR and full restore drills pass with integrity verification and meet RPO/RTO targets; offsite copies verified.
3. Security: zero open critical/high findings from scans and the external pen test (retest evidence); ASVS L2 matrix complete; secrets rotation and key-recovery drills passed; privileged access reviewed; audit export integrity verified.
4. Observability: all alerts fire and route correctly; dashboards and runbooks reviewed by operations; SLO dashboards live; synthetic and real-user monitoring active.
5. Performance on production hardware meets all budgets (section 6) including under payroll load; soak and spike tests pass without leaks or pool exhaustion.
6. Zero-downtime deploy and rollback verified under load.
7. Migration: three dry runs reconcile with signed difference reports; final migration rehearsed within the cutover window; rollback rehearsed.
8. UAT signed by HR, Finance, managers and employee representatives; no open S1/S2 defects; accessibility audit passed (documented exceptions only).
9. Privacy/legal artifacts approved by counsel; training delivered and attendance recorded; support channel and hypercare rota staffed.
10. First live payroll executed per protocol with CA and Finance sign-off; hypercare exit criteria met; handover to steady operations accepted by the owners.
