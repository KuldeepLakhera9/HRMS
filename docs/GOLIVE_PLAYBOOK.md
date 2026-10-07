# GO-LIVE PLAYBOOK: people, data, UAT, training, legal, cutover, hypercare, handover

Owner: product owner. Contributors: HR lead, Finance lead, IT/DevOps lead, security lead, CA, legal counsel, department champions. The AI agent prepares drafts, scripts and templates; humans decide, execute and sign.
Legal and tax notes in this document are planning guidance, not legal advice. Counsel and your CA confirm.

## 1. Governance
| Role | Responsibility | Decision rights |
|---|---|---|
| Executive sponsor | Business priority, resources, final escalation | Approve go-live date, accept residual risk |
| Product owner | Scope, UAT, communications, hypercare priorities | Go/no-go recommendation |
| HR lead | Policies, data accuracy, training, employee support | Sign-off on HR modules and data |
| Finance lead + CA | Payroll accuracy, statutory outputs | Sign-off on payroll go-live (CA kit form) |
| IT/DevOps lead | Infrastructure, deployments, backups, monitoring | Technical go/no-go, rollback decision |
| Security lead | Pen test, access, incident handling | Security go/no-go, risk acceptance proposal |
| Legal/DPO contact | Privacy notice, consent, retention, breach process | Legal readiness sign-off |
| Department champions | Peer support, feedback | none (advisory) |
Rules: **go/no-go committee** = sponsor, product owner, HR, Finance, IT, security, legal (CA advises on payroll). Decisions are recorded with date and rationale. A change freeze starts at T-14 days (only fixes approved by the committee). Weekly status report with risks, open defects, readiness score.

## 2. Rollout strategy
| Wave | Audience | Content | Entry criteria |
|---|---|---|---|
| 0 (done) | Pilot department | Attendance + leave (Phase 3 pilot) | Pilot sign-off |
| 1 | HR, Finance, admins, IT | Full platform, payroll parallel run, data verification | UAT sign-off, migration dry run 3 passed |
| 2 | Managers | Approvals, team views, expenses approval | Training done, wave 1 stable for 1 week |
| 3 | All employees | Attendance, leave, payslips, declarations, expenses | Wave 2 stable, support rota active |
Attendance policy phase-in: first 2 weeks **soft geofence** (outside-fence punches go to review), then tighten per data (radius, accuracy limits), then strict where appropriate. Payroll cutover occurs at the start of a pay month agreed with the CA (see CA kit section 8); the first live payroll happens only after the CA/Finance sign-off form is complete.

## 3. Data migration playbook
### 3.1 Datasets and owners
| Dataset | Owner | Source | Key checks |
|---|---|---|---|
| Employee master (personal, job, reporting lines) | HR | Current HR sheets/system | Unique emp codes, valid dates, manager exists, no cycles, active/inactive status |
| Org structure (departments, designations, grades, cost centers, locations) | HR | HR | Codes unique, hierarchy valid |
| Bank and identity data (bank, IFSC, PAN, UAN, ESI no.) | HR/Finance | Payroll files | IFSC/PAN format, duplicates, account number length, UAN presence for PF members |
| Salary and structures | Finance | Payroll files | Matches latest payslip gross/net, structure assignment, effective dates |
| Leave balances | HR | Leave records | Per type balances equal source totals |
| Attendance history (optional) | HR | Attendance records | Date ranges, punches mapping |
| YTD payroll and tax (opening balances) | Finance/CA | Payroll reports | YTD totals equal old reports per employee and component |
| Declarations and previous-employer data | Finance | Collected forms | Regime, amounts, proofs |
| Documents (scans) | HR | Folders | Checksum manifest, type mapping, size/format rules |
| Loans/advances | Finance | Ledger | Outstanding principal and schedule |
### 3.2 Procedure
1. Mapping specification signed per dataset (source column, target field, transformation, validation, owner).
2. **Cleansing**: run the data-quality report (duplicates, invalid formats, missing mandatory fields, inconsistent hierarchy); data owners decide fixes in the source (not in the database). Keep a decisions log.
3. **Dry run 1** on production-like staging (protected like production): import everything, produce reconciliation (counts, sums, referential integrity, 50 random employee spot checks compared by HR, 20 by Finance), timings.
4. **Dry run 2** after fixes; repeat. **Dry run 3** = rehearsal of the real cutover timeline with the same people, scripts and time limits.
5. Exit criteria for each dry run: zero unexplained differences in counts and sums, all blockers closed, importer runtime within the cutover window with 30% margin, rollback rehearsed.
6. **Final migration** in the cutover window after the freeze: final extract, import, verification queries, data-owner sign-off, snapshot/PITR marker taken before and after import.
7. **Rollback** before go-live acceptance: restore to the pre-import marker and continue the old process.
8. Post-migration: invite waves, MFA enrollment sessions, device registration for mobile, geofence defaults confirmed per location.
Security: dry-run data is real personal data; staging access limited to named people, audit on, wiped or promoted after use; no real data on laptops or in chat tools.

## 4. UAT plan
### 4.1 Setup
Environment: production-like staging with migrated dry-run data. Participants: HR (2-3), Finance (2), managers (3-5), employees across locations (5-8), IT/admin (1-2), CA (payroll). Duration: 2 weeks plus a fix and re-test week. Test accounts per role; mobile devices for field tests.
### 4.2 Entry and exit criteria
Entry: feature freeze, staging stable, migration dry run 2 passed, scripts approved, training for testers done. Exit: all P1/P2 scripts executed, no open S1/S2 defects, S3 defects have a fix date or accepted workaround, regression suite green, sign-off table completed.
### 4.3 Severity
S1 data loss, wrong payroll, security issue, system unavailable. S2 major function broken without workaround. S3 function degraded with workaround. S4 cosmetic. SLAs during UAT: S1 same day, S2 two days.
### 4.4 Script template
`ID | Role | Module | Preconditions | Steps | Expected result | Actual | Pass/Fail | Defect ID | Tester/Date`
### 4.5 Scenario list (minimum; expand with HR/Finance)
Access: invited user activates, sets password, enrolls MFA, logs in; lockout and reset; session revoke; role changes take effect immediately.
Employee records: create, edit with history, sensitive fields masked and reveal with step-up, document upload and verification, change request approval, bulk import with errors, org chart.
Attendance: punch inside fence (mobile), outside fence (soft) and review, low accuracy retry, offline punch sync, forgot punch-out and regularization, night shift, roster publish, live board, month lock, device change request, biometric import (if used).
Leave: apply with preview, half day, sandwich rule, holiday overlap, insufficient balance, clash warning, approval/rejection/withdrawal/cancellation, comp-off, balances after year-end rollover (simulated), calendar views, delegation when approver on leave, escalation after SLA.
Payroll: setup structures and rules (maker-checker), salary assignment and revision with arrears, inputs, calculate, review variance, explain payslip, approve (second user), lock, publish, employee views payslip, bank file generation and validation, statutory outputs, correction run, unlock rules, YTD opening balances, TDS regime comparison, declarations and proofs.
Expenses: claim with bills, policy flags, duplicate bill, partial approval, payout via payroll, bank reimbursement file.
Reports and dashboards: each report against known expected values, export and schedule, dashboards per role.
Announcements and helpdesk: publish, targeting, read receipts; ticket lifecycle with SLA.
Security and privacy: IDOR attempts by testers, access to others' payslips denied, export audit, consent screens, privacy notice visibility.
Non-functional: performance from office network and mobile data, accessibility spot checks, browser/device matrix.
### 4.6 Defect workflow
New -> triaged (owner, severity) -> fixed -> deployed to staging -> verified by reporter -> closed. Daily triage during UAT. Regression test added for every S1/S2 defect.
### 4.7 Sign-off
| Area | Name | Role | Date | Decision (accept / accept with conditions / reject) | Conditions |
|---|---|---|---|---|---|

## 5. Accessibility and device matrix
- WCAG 2.1 AA: axe automated runs on all key pages; manual keyboard-only walkthroughs; screen reader (NVDA on Windows, VoiceOver on iOS/macOS) for login, dashboard, attendance, leave apply, approvals, payslip view; contrast report from the design-system test; focus order, labels, error messages, zoom to 200%, reduced-motion.
- Browsers: current and previous major versions of Chrome, Edge, Firefox, Safari. Devices: the Android and iOS versions actually used by staff (collect list), low-end Android device, large-text settings.
- Record exceptions with owner and fix date; none may block core flows.

## 6. Training and communications
### 6.1 Audiences and formats
| Audience | Content | Format | Length |
|---|---|---|---|
| Employees | Install app, login + MFA, clock in/out, leave, payslips, declarations, expenses, helpdesk, privacy notice | Live session + 5 short videos + one-page guides + in-app tour | 45 min |
| Managers | Approvals inbox, team calendar and live board, regularization review, expense approval, delegation | Live workshop + guide | 60 min |
| HR | Employee records, policies, geofence/policies/rosters, exceptions, leave admin, announcements, reports, audit | Workshop + sandbox practice | 3 hours |
| Finance | Payroll cycle, maker-checker, review and variance, bank files, statutory outputs, corrections, expenses payout, reconciliation | Workshop with a dry-run cycle | 4 hours |
| Admins/IT | Access management, monitoring dashboards, runbooks, deployments, backups, incident process | Hands-on + drill participation | 4 hours |
### 6.2 Materials checklist
Quick-start cards (employee, manager), FAQ (top 40 questions), troubleshooting guide for the mobile app (location permission, GPS accuracy, offline queue, device change), HR admin handbook, Finance payroll handbook with SoD explanation, video scripts, in-app tours, training environment with sample data, attendance and location policy summary, support contacts and hours.
### 6.3 Communications calendar
| When | Message | Channel |
|---|---|---|
| T-30 | Announcement: what is changing, why, dates, benefits | Email + town hall |
| T-21 | Privacy notice and location/selfie consent explained; where to read it | Email + intranet |
| T-14 | Training schedule, app install instructions, support channels | Email + posters |
| T-7 | Reminder, champions list, FAQ | Email + chat |
| T-1 | Final instructions, first-day checklist | Email + SMS |
| Go-live | Welcome, how to get help, known issues list | Email + in-app banner |
| +3, +7 | Tips, common questions, feedback survey | Email + in-app |
| +30 | Results, thanks, next improvements | Email |
### 6.4 Support model
Helpdesk-lite channel plus a dedicated chat/phone line during hypercare; champions in each department; office hours for the first 2 weeks; severity SLAs in section 10; knowledge base updated daily from tickets.

## 7. Privacy and legal readiness
### 7.1 Context (confirm with counsel)
The Digital Personal Data Protection Rules, 2025 were notified in November 2025 with phased commencement: consent-manager provisions around November 2026, and the main fiduciary obligations (notice, consent, security safeguards, breach reporting, data principal rights) around May 2027. Secondary sources report a 72-hour reporting expectation for breaches to the Data Protection Board plus notification to affected individuals. The platform goes live inside this window, so design for compliance now. Counsel decides which processing relies on consent versus employment-related legitimate use, and the exact breach timelines.
### 7.2 Deliverables
| Item | Content | Owner |
|---|---|---|
| Privacy notice (employees) | What is collected (profile, attendance location, selfie, payroll, bank, health-related leave data if any), purposes, retention, who can see it, rights, how to complain, grievance contact; plain language; local-language version if required | Legal + HR |
| Location and selfie consent | Separate, specific text shown in the mobile app and web with version and timestamp stored; withdrawal path and consequence (alternative attendance method) | Legal + HR |
| Retention schedule | Selfies/raw location (default 90 days), attendance records, leave, payroll and statutory records (per law), audit logs, backups, notifications; configured in the platform; deletion jobs verified | Legal + CA |
| Rights-request process | Access, correction, erasure, grievance: intake via helpdesk category, identity verification, response SLA, audit trail | HR + IT |
| Breach response playbook | Detection, containment, assessment, notification content and timing to the Board and affected individuals, communication roles, evidence handling, table-top exercise held | Security + Legal |
| Processor/vendor register | Push provider (FCM/APNs metadata), SMTP relay, attestation providers, backup/offsite provider, pen-test vendor; contracts and data-processing terms; cross-border considerations | Legal + IT |
| Records of processing | Systems, data categories, purposes, access roles, retention | DPO contact |
| Monitoring policy | Attendance geofencing rules, no continuous tracking, who can view coordinates and why, audit of views | HR + Legal |
| Security safeguards evidence | Encryption, access control, logging, backups, testing (from this phase's evidence pack) | Security |
### 7.3 Labour and payroll compliance
Payslip content and record retention, statutory registers, Professional Tax and PF/ESI registrations per state, Labour Code wage treatment, final settlement timelines: confirmed by the CA and counsel (see `CA_VALIDATION_KIT.md`).
### 7.4 Sign-off
Counsel approves the notice, consent text, retention schedule, breach playbook and vendor terms. Without this sign-off, location/selfie collection stays disabled.

## 8. Cutover runbook
### 8.1 Timeline (adapt to your calendar; rehearse in dry run 3)
| When | Activity | Owner |
|---|---|---|
| T-14 | Change freeze; final UAT sign-off; go/no-go pre-read published | Product owner |
| T-10 | Production environment verified against staging (config diff), backups and drills evidence reviewed; certificates valid > 60 days | IT |
| T-7 | Training complete; comms sent; support rota published; hypercare room booked | Product owner |
| T-3 | Go/no-go meeting #1 (conditional); dry-run 3 results confirmed; rollback rehearsal done | Committee |
| T-1 | Final backup + snapshot marker; freeze of old system inputs agreed; on-call confirmed | IT |
| T-0 hour 0 | Start window; announce maintenance; old system read-only | IT |
| h+1 | Final data extract and validation (counts, checks) | HR/Finance |
| h+2 | Import into production; run verification queries; spot checks | IT + data owners |
| h+4 | Data-owner sign-offs; snapshot marker after import | HR/Finance |
| h+5 | Configuration verification (policies, geofences, roles, rules, feature flags for the wave) | IT + HR |
| h+6 | Smoke tests (list below); monitoring green; go/no-go meeting #2 | Committee |
| h+7 | Enable wave access; invites sent in batches; war room opens | Product owner |
| h+8 onward | Hypercare begins | All |
### 8.2 Smoke test list (automated where possible, run on production with a test employee)
Login + MFA; permissions per role; punch inside fence with the test device; attendance today and live board; leave preview and apply/cancel on a test account; payslip view for a test payslip; report preview and small export; notification delivery (in-app, email, push); file upload and download; admin audit entry visible; backup job status green; synthetic probes green; RUM receiving data.
### 8.3 Rollback criteria (any of)
Data verification fails with unexplained differences; authentication or authorization defect; data loss or corruption; sustained availability below target in the first hours; failed smoke tests that cannot be fixed within the window. Procedure: stop invites, restore to the pre-import marker, re-enable the old process, communicate, hold a review before a new date. **Point of no return**: after real employee punches, leave requests or payroll actions exist, rollback becomes a forward fix (hotfix lane) rather than a restore. The committee declares the point of no return explicitly (default: after the first full day of wave 3 usage).

## 9. First live payroll protocol (P5-PAY-01)
Preconditions: CA/Finance sign-off form complete (CA kit section 7), parallel cycles clean, opening balances reconciled, bank file dry run accepted by the bank, rules active and pinned, SoD users assigned, deploy freeze in place.
Sequence: (1) attendance month lock and exception clearance; (2) inputs entered and approved; (3) calculate; (4) variance review with Finance and CA, explanations for all outliers; (5) second-person approval; (6) lock; (7) payslips published; (8) bank file generated by approver, validated by the bank portal checker, uploaded by Finance; (9) payment confirmations imported; (10) statutory outputs generated and reconciled; (11) post-payroll review within 3 working days (issues log, employee queries, corrections via correction/off-cycle run if needed); (12) CA review of first-cycle statutory data.
Standby: Finance, CA contact, DevOps on call, product owner. No deployments during the window. Keep the old process available until the first cycle is accepted.

## 10. Hypercare (2 to 4 weeks)
- **Staffing**: war room (physical or chat) during working hours for week 1; daily 15-minute stand-up; named on-call outside hours; fast-fix lane (hotfix pipeline with security and critical-flow tests).
- **Severity and SLAs**: S1 response 15 min, workaround/fix target 4 h; S2 response 1 h, fix 1 working day; S3 response 4 h, fix in the next release; S4 backlog.
- **Daily health review**: availability, latency (RUM and API), error rates, queue health, punch success by reason, regularization volume, support tickets by category, login/MFA problems, notification delivery, backup status, security alerts.
- **KPIs**: adoption (share of employees with a punch per day, app vs web), ticket volume trend, mean time to resolve, punch failure rate, approval turnaround, user satisfaction pulse (2 questions).
- **Exit criteria** (all): 14 consecutive days without S1/S2, SLOs met for 14 days, ticket volume trending down, first payroll accepted and post-payroll review closed, backlog triaged with owners, runbooks updated from real incidents, handover meeting held.

## 11. Rollback and contingency decision tree
1. Is data or security affected? Yes: S1, invoke incident process, contain first (disable affected feature via flag or maintenance mode), decide rollback vs forward fix with IT, security and product owner.
2. Is the issue a deploy regression? Roll back the image (database compatible by design) and verify.
3. Is it infrastructure? Follow the runbook (failover, restore); communicate ETA.
4. Is it limited to one wave or feature? Use feature flags to disable for the wave.
5. Always: communicate (who, what, when next update), log the timeline, hold a post-incident review within 5 working days.
Contingency for attendance: if the mobile punch path is unavailable, HR enables the approved fallback (manual attendance sheet to be regularized). For payroll: continue the old process for that cycle if the new run cannot be approved and locked in time.

## 12. Business-as-usual handover
| Area | Owner | Cadence |
|---|---|---|
| Patching | IT | OS security updates weekly (reboot window monthly), PostgreSQL/Redis minor updates quarterly, dependency updates weekly via automated PRs |
| Backups and restore tests | IT | Automated weekly restore test, quarterly full restore drill |
| DR and failover drills | IT + security | Every 6 months; tabletop for security incident yearly |
| Penetration test | Security | Annually and after major changes |
| Access reviews | Security + HR | Quarterly (privileged), semi-annual (all roles) |
| Rules review (payroll/statutory) | Finance + CA | Quarterly and on each notification/Finance Act change |
| Capacity and cost review | IT | Quarterly using scale-out triggers |
| SLO and error-budget review | IT + product owner | Monthly |
| Retention and deletion jobs verification | HR + IT | Quarterly |
| Policy review (attendance, leave, consent text) | HR + legal | Annually |
| Backlog and roadmap | Product owner | Monthly prioritization |
Handover package: architecture and infra docs, runbooks, evidence pack, credentials custody register (not the secrets), contact/escalation list, SLA document, known issues and risk register, training materials, roadmap.

## 13. Go/no-go checklist (Gate G5) and templates
### 13.1 Checklist (each item needs evidence link, owner, date)
**Security**
- [ ] External pen test complete; zero open critical/high; retest evidence
- [ ] ASVS L2 matrix complete; SAST/DAST/SBOM/image scans clean for critical/high
- [ ] MFA enforced for admin, HR, finance, payroll roles
- [ ] DB, Redis, object storage, Vault unreachable from the internet; only 443 open at the edge
- [ ] Secrets only in Vault; rotation drill passed; key custody and recovery drill passed
- [ ] Privileged access reviewed; break-glass sealed; audit export integrity verified
**Reliability**
- [ ] Failover drills passed with measured results; zero committed-data loss
- [ ] Backups running; offsite verified; PITR and full restore drills passed with integrity checks; restore test within 7 days
- [ ] DR drill timings meet RTO/RPO or accepted gaps recorded
- [ ] Zero-downtime deploy and rollback verified under load
- [ ] Load (2x), soak (24 h) and spike tests passed on production hardware
**Observability and operations**
- [ ] All alerts fired and routed in test; dashboards and SLO views live; synthetic and RUM active
- [ ] Runbooks complete and reviewed; on-call rota and escalation active; incident process rehearsed
**Functional and data**
- [ ] UAT signed; no open S1/S2
- [ ] Accessibility audit passed (documented exceptions only)
- [ ] Migration dry run 3 reconciled; rollback rehearsed; final migration plan timed
- [ ] Payroll: golden cases 100%, parallel cycles signed, bank file validated, CA/Finance sign-off form complete
- [ ] Geofence defaults tuned from pilot data; soft/strict decision recorded
**People and legal**
- [ ] Privacy notice, consent text, retention schedule, breach playbook, vendor terms approved by counsel
- [ ] Training delivered and attendance recorded; support channel and hypercare rota staffed
- [ ] Communications sent; cutover and rollback criteria agreed; point-of-no-return rule agreed
**Decision**: GO / NO-GO / GO WITH CONDITIONS. Signatories: sponsor, product owner, HR, Finance, IT, security, legal. Date and conditions recorded.
### 13.2 Templates (store in `docs/templates/`)
- Incident report: ID, detected by/when, severity, systems/users affected, timeline, root cause, containment, resolution, data impact, notifications sent, follow-ups with owners/dates.
- Post-mortem: summary, impact, detection, timeline, what went well, what went wrong, root cause analysis (5 whys), action items (owner, due date, verification), lessons for runbooks.
- Change request: what/why, risk and impact, test evidence, rollback plan, window, approver, post-change verification.
- Drill report: drill ID, hypothesis, date/participants, steps, expected vs measured results (timings, data integrity), issues found, fixes and re-test, sign-off.
- Defect record: ID, severity, module, steps, expected/actual, evidence, owner, status history, regression test link.
- Decision log: date, decision, alternatives, rationale, owner.
