# ADR 0012: In-Memory Prometheus Telemetry and Database Slow-Query Guard

## Status
Accepted

## Context
Production operations in our private data center require real-time visibility into HTTP request latencies, PostgreSQL pool status, active sessions, and database query durations. We require native Prometheus scraping without adding heavyweight external agents.

## Decision
1. **In-Memory Prometheus Registry**:
   - Implemented `MetricsRegistry` in `@hrms/core` supporting standard Counters, Gauges, and Latency Histograms.
   - Outputs Prometheus exposition text format 0.0.4.
   - Endpoint `/api/metrics` is exposed for internal scraping, protected by `METRICS_TOKEN` or private VPC network access.

2. **Database Pool & Query Telemetry**:
   - PostgreSQL connection pool gauges (`db_pool_total`, `db_pool_idle`, `db_pool_waiting`) are sampled from `getPoolStats()`.
   - `withTenant` client wraps query execution, timing individual SQL statements.
   - Slow-Query Guard: Any query exceeding 100 ms is automatically logged with a `[Slow Query]` warning snippet for immediate DBA inspection.

3. **Graceful Shutdown**:
   - Web application and background worker intercept `SIGTERM` and `SIGINT`.
   - Queues and timers are paused, pending requests are allowed up to 10 seconds to drain, Redis client quits cleanly, and PostgreSQL pools are closed via `closePools()`.

## Consequences
- Zero third-party telemetry SaaS dependencies.
- Standard integration with Prometheus, VictoriaMetrics, and Grafana dashboards.
- Continuous assertion of p95 read <= 200 ms and write <= 400 ms performance targets.
