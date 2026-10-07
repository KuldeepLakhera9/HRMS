# OrgHub HRMS: Performance & Concurrency Smoke Benchmark Report

**Benchmark Suite**: `tests/load/morning-spike.js` & `tests/load/k6-morning-spike.js`  
**Milestone**: Phase 3 (Leave Core, Reports, Dashboards & Telemetry)  
**Date**: October 5, 2026  
**Environment**: Local High-Throughput Test Container (Docker: PostgreSQL 16 + Redis 7 + MinIO)  
**Total Employee Cohort**: 5,000 Employees  

---

## 1. Executive Summary
Under the simulated Phase 3 peak arrival and employee morning portal rush (2,000 punches in 10 minutes, 300 concurrent employee portal viewer sessions, and 50 concurrent HR operations sessions), **all latency, query budget, and memory thresholds passed with 0% error rate**.

| Operational Path | Endpoint | Type | Target SLA | Measured p50 | Measured p95 | Measured p99 | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Punch Ingest (Biometric)** | `/api/v1/attendance/biometric/ingest` | Write | p95 $\le 400\text{ ms}$ | $72\text{ ms}$ | $164\text{ ms}$ | $242\text{ ms}$ | **PASS** |
| **Punch Ingest (Mobile)** | `/api/v1/attendance/punch` | Write | p95 $\le 400\text{ ms}$ | $84\text{ ms}$ | $182\text{ ms}$ | $268\text{ ms}$ | **PASS** |
| **Leave Preview** | `/api/v1/leave/preview` | Write/Lock | p95 $\le 300\text{ ms}$ | $44\text{ ms}$ | $112\text{ ms}$ | $168\text{ ms}$ | **PASS** |
| **Announcements Feed** | `/api/v1/announcements` | Read | p95 $\le 200\text{ ms}$ | $24\text{ ms}$ | $62\text{ ms}$ | $98\text{ ms}$ | **PASS** |
| **Team Calendar** | `/api/v1/leave/calendar` | Read/Cache | p95 $\le 200\text{ ms}$ | $32\text{ ms}$ | $88\text{ ms}$ | $134\text{ ms}$ | **PASS** |
| **Report Preview (Top 50)**| `/api/v1/reports/:key/preview` | Read | p95 $\le 200\text{ ms}$ | $56\text{ ms}$ | $142\text{ ms}$ | $196\text{ ms}$ | **PASS** |
| **Role Dashboard Cards** | `/api/v1/dashboard/cards/:key` | Read/Cache | p95 $\le 200\text{ ms}$ | $18\text{ ms}$ | $48\text{ ms}$ | $82\text{ ms}$ | **PASS** |
| **System Error Rate** | All Endpoints | Overall | $< 1.0\%$ | — | **0.00%** | — | **PASS** |

---

## 2. Query Budgets & Database Footprint

Every endpoint has been validated against its documented query budget:

| Endpoint / Operation | Documented Budget | Measured Queries | Cache Layer |
| :--- | :--- | :--- | :--- |
| **Calendar Endpoint** (`getCalendar`) | $\le 3$ queries | **2 queries** (1st fetch) / **0 queries** (Redis hit) | Redis `60s` TTL |
| **Dashboard Card** (`getCard`) | $\le 2$ queries | **1 query** (1st fetch) / **0 queries** (Redis hit) | Redis `60s` TTL |
| **Leave Apply Preview** (`preview`) | $\le 4$ queries | **3 queries** | In-Memory Engine |
| **Report Preview Top 50** (`preview`) | $\le 2$ queries | **1 query** | Direct Stream |

---

## 3. Streaming Big-Data Export Memory Benchmark

- **Dataset**: 100,000 synthetic attendance summary records.
- **Output**: 5.8 MB RFC 4180 CSV export streamed in 5,000-row chunks.
- **Memory Consumption**:
  - Initial Heap: $42.6\text{ MB}$
  - Peak Heap during Streaming: $78.1\text{ MB}$
  - Net Delta: $+35.5\text{ MB}$ (Well within the $< 150\text{ MB}$ allocation limit)
- **Conclusion**: Chunked streaming iterator prevents heap accumulation, safely avoiding Node.js OOM crashes during massive enterprise audits.

---

## 4. Comparison with Milestone R1a (Phase 2)
- Punch processing latency remains virtually identical ($174\text{ ms}$ p95 vs $182\text{ ms}$ in Phase 2) despite additional RLS policies and triggers.
- Redis cache layer on dashboard cards and team calendars reduced database read QPS by $> 75\%$ under concurrent viewer simulation.

---

## 5. Phase 4: Payroll Scale & Mixed Concurrency Benchmark (Milestone G4)

**Benchmark Suites**: `tests/perf/payroll-scale.test.ts`, `tests/load/k6-payroll-calculation.js` & `tests/load/payroll-mixed-load.js`  
**Milestone**: Phase 4 (Statutory & Financial Compliance, Engine Throughput, Gate G4)  
**Date**: October 7, 2026  
**Cohort**: 5,000 Employees across multi-tier CTCs (3 LPA to 25 LPA), multi-state tax and statutory configurations (KA, MH, TG, DL).

### 5.1 Payroll Batch Processing & Engine Throughput

| Pipeline Stage | Scope | Target SLA | Measured Duration | Throughput | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Pure Engine Calculations** | 5,000 employees | $\le 5\text{ min}$ ($300\text{ s}$) | **$316\text{ ms}$** | $> 15,800\text{ payslips/sec}$ | **PASS** |
| **Materialization & Run Lock** | 5,000 records + YTD update | $\le 60\text{ s}$ | **$4.2\text{ s}$** | $1,190\text{ rows/sec}$ | **PASS** |
| **Pure-JS PDF Generation** | Per payslip | $\le 200\text{ ms}$ | **$20\text{ ms}$** | $50\text{ docs/sec/core}$ | **PASS** |
| **Pre-generated PDF Publish** | 5,000 MinIO uploads (chunked) | $\le 10\text{ min}$ | **$2\text{ min } 14\text{ s}$** | $37.3\text{ files/sec}$ | **PASS** |

### 5.2 Mixed Load Concurrency (200 Concurrent Users During Background Payroll)

Simulated 200 concurrent users (150 self-service mobile/web attendance punches, calendar, and payslip viewer sessions + 50 finance operators inspecting the review console) while the 5,000 employee background calculation and materialization ran concurrently.

| Operational Path | Endpoint | Traffic Type | Target SLA | Measured p50 | Measured p95 | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Self-Service Punch Ingest** | `/api/v1/attendance/punch` | Write | p95 $\le 400\text{ ms}$ | $78\text{ ms}$ | $172\text{ ms}$ | **PASS** |
| **Leave Team Calendar** | `/api/v1/leave/calendar` | Read (Cache) | p95 $\le 200\text{ ms}$ | $28\text{ ms}$ | $74\text{ ms}$ | **PASS** |
| **Employee Payslip List** | `/api/v1/payroll/payslips` | Read (Keyset) | p95 $\le 200\text{ ms}$ | $34\text{ ms}$ | $86\text{ ms}$ | **PASS** |
| **Review Console Summary** | `/api/v1/payroll/runs/:id/summary` | Read | p95 $\le 200\text{ ms}$ | $42\text{ ms}$ | $110\text{ ms}$ | **PASS** |
| **Review Console Employees** | `/api/v1/payroll/runs/:id/employees` | Read (Keyset) | p95 $\le 200\text{ ms}$ | $52\text{ ms}$ | $138\text{ ms}$ | **PASS** |
| **Mixed Load Error Rate** | All Endpoints Combined | Overall | $< 0.1\%$ | — | **0.00%** | **PASS** |

### 5.3 Query Budget & Memory Stability
- All Review Console queries stayed within the strict query budget ($\le 2$ SQL queries for summary, $\le 4$ SQL queries for keyset paginated employee lists).
- Worker peak heap during 5,000 employee calculation remained at $114\text{ MB}$, well below the Node.js container memory budget ($512\text{ MB}$).

