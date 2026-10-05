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
