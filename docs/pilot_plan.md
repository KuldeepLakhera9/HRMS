# OrgHub HRMS: Phase 3 Operational Pilot Plan

## 1. Executive Summary & Goals
The Phase 3 Pilot introduces **Attendance, Leave Management, Reporting, Announcements, and Helpdesk** to real employee cohorts in our self-hosted enterprise data center.

### Primary Pilot Objectives:
1. **Adoption & Usability**: Validate employee self-service adoption on mobile and web channels with $\ge 85\%$ active engagement.
2. **Operational Reliability**: Prove high-throughput morning arrival punch processing under real hardware conditions (biometrics + GPS geofences).
3. **Leave Accounting Accuracy**: Confirm that accrual, deduction, carry-forward, and encashment workflows operate flawlessly with zero ledger mismatches.
4. **Data Integrity & Tenant Isolation**: Verify dual-layer PostgreSQL RLS and composite FK isolation across multi-tenant boundaries.

---

## 2. Pilot Cohorts & Rollout Waves

The pilot encompasses **5,000 total personnel** rolled out across three controlled waves:

| Wave | Timeline | Cohort / Departments | Headcount | Target Modules |
| :--- | :--- | :--- | :--- | :--- |
| **Wave 1** | Week 1 (Days 1–5) | **IT, HR Operations, Finance** | 450 | Attendance (Web + Mobile), Leave Balances, Announcements, Helpdesk |
| **Wave 2** | Week 2 (Days 6–12) | **Corporate HQ, Product & Engineering, Marketing** | 1,800 | Full Leave Workflows, Team Calendars, Geofencing, Reports Preview |
| **Wave 3** | Week 3 (Days 13–21) | **Warehouse Operations, Field Logistics, Retail Outlets** | 2,750 | Biometric Turnstiles, Offline Punch Queue, Night Shifts, Overtime |

---

## 3. Key Performance Indicators (KPIs) & Target Exit Gates

| Metric | Target | Measurement Method | Gate Threshold |
| :--- | :--- | :--- | :--- |
| **Active Employee Adoption** | $\ge 85\%$ | Telemetry: Daily distinct punch / portal visits | Pass $\ge 80\%$ |
| **Average CSAT Score** | $\ge 4.2 / 5.0$ | In-App Feedback Widget (`pilot_metrics`) | Pass $\ge 4.0$ |
| **Punch Processing Latency** | p95 $\le 400\text{ ms}$ | k6 Morning Spike Benchmark & Prometheus | Pass $\le 400\text{ ms}$ |
| **Report Preview Latency** | p95 $\le 200\text{ ms}$ | Prometheus endpoint timer | Pass $\le 200\text{ ms}$ |
| **Attendance Regularization Rate** | $< 10\%$ | Ratio of missed/corrected punches to total days | Pass $< 12\%$ |
| **Leave Approval Turnaround** | $< 8\text{ hours}$ | Median time from submission to approval | Pass $< 12\text{ hours}$ |
| **Data Ledger Discrepancies** | **0** | Reconcile balances worker query | **Strict 0** |

---

## 4. Roles & Governance

- **Pilot Lead**: Head of People Operations & Enterprise Architecture.
- **Triage Engineers**: Antigravity dev team (monitoring Pino logs, Sentry, Redis queues).
- **Floor Champions**: 10 trained HR champions distributed across buildings to assist employees with initial mobile app login and biometric onboarding.
- **Daily Standup**: 15-minute triage at 10:00 AM UTC (reviewing morning punch telemetry and CSAT feedback).

---

## 5. Escalation & Support Matrix

- **Priority 1 (Service Outage / Biometric Gate Failure)**:
  - SLA: 15-minute response, 1-hour resolution.
  - Action: Immediate switch to Web/Mobile GPS backup punch; trigger emergency runbook.
- **Priority 2 (Leave Calculation or Approval Bug)**:
  - SLA: 1-hour response, 4-hour resolution.
  - Action: Hotfix patch or manual admin balance adjustment.
- **Priority 3 (General Usability / Cosmetic / Feedback)**:
  - SLA: 24-hour response; batched for weekly release.

---

## 6. Pilot Exit & Gate G3 Transition Checklist
- [x] All 8 Phase 3 Reports validated against golden dataset.
- [x] Morning-spike load test verified at 200 concurrent writes / 300 concurrent reads.
- [x] Zero unresolved P1 or P2 tickets in Helpdesk.
- [x] Data migration engine validated with test opening leave balances and historical punches.
- [x] Operational runbooks published and tested by on-call engineers.
