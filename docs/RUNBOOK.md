# HRMS Operational Runbook

## 1. Service Health & Telemetry Probes

| Endpoint | Purpose | Target Response | Recovery Action if Failing |
|---|---|---|---|
| `GET /api/health` | Kubernetes / Load Balancer Liveness Probe | `200 OK` (JSON: `status: "ok"`) | Restart container / instance process |
| `GET /api/ready` | Readiness Probe (Verifies PostgreSQL & Redis connections) | `200 OK` (JSON: `status: "ready"`) | Check PostgreSQL listener and Redis connectivity |
| `GET /api/metrics` | Prometheus Metrics Scrape (Internal) | `200 OK` (Prometheus 0.0.4 text) | Verify `METRICS_TOKEN` header or VPC routing |

---

## 2. PostgreSQL Database Operations & Maintenance

### Database Roles & Connections
- **Owner Role** (`hrms_owner`): Used solely for schema migrations, table creation, and RLS policy updates. Bypasses RLS (`BYPASSRLS`).
- **Application Role** (`hrms_app`): Connects through PgBouncer in **transaction mode**. Strict `NOBYPASSRLS`. All queries execute inside `withTenant` with `SELECT set_config('app.company_id', $1, true)`.
- **Worker Role** (`hrms_worker`): Background jobs and outbox relay.
- **Read-Only Role** (`hrms_readonly`): Analytics and reporting.

### Automated Partition Maintenance
- `audit_logs` is partitioned by month: `audit_logs_yYYYYmMM`.
- `PartitionMaintenanceWorker` in `apps/worker` runs daily to pre-create partitions 3 months in advance and verify retention.
- Manual partition check query:
  ```sql
  SELECT inhrelid::regclass AS partition_name
  FROM pg_inherits
  WHERE inhparent = 'audit_logs'::regclass
  ORDER BY 1 DESC;
  ```

### Backup & Restore Procedures

#### Automated Daily Logical Backup
```bash
# Export compressed PostgreSQL backup as hrms_owner
pg_dump -h $PGHOST -U hrms_owner -d hrms -Fc -f /backups/hrms_$(date +%Y%m%d_%H%M%S).dump
```

#### Restoring Backup
```bash
# Restore into target database
pg_restore -h $PGHOST -U hrms_owner -d hrms_restored --clean --if-exists /backups/hrms_YYYYMMDD_HHMMSS.dump
```

#### Point-In-Time Recovery (PITR)
- In production, WAL archiving must be enabled: `archive_mode = on`, `archive_command = 'cp %p /wal_archive/%f'`.
- Restore target time via `recovery_target_time = 'YYYY-MM-DD HH:MM:SS UTC'` in `postgresql.conf`.

---

## 3. Incident Triage Runbooks

### Runbook 1: PostgreSQL Connection Starvation
- **Symptoms**: `/api/ready` returns 503; `db_pool_waiting` metric spikes > 10; log errors `Timeout: pool is full`.
- **Diagnosis**:
  ```sql
  SELECT count(*), state, application_name FROM pg_stat_activity WHERE datname = 'hrms' GROUP BY state, application_name;
  ```
- **Action**:
  1. Inspect long-running idle transactions:
     ```sql
     SELECT pid, now() - xact_start AS duration, query FROM pg_stat_activity WHERE state IN ('idle in transaction') AND now() - xact_start > interval '30 seconds';
     ```
  2. Terminate rogue query: `SELECT pg_terminate_backend(<pid>);`
  3. Ensure `idle_in_transaction_session_timeout = 10000` is active.

### Runbook 2: Database Slow Query Alerts
- **Symptoms**: Pino logs show `[Slow Query] > 100ms`.
- **Diagnosis**:
  Review statement snippet in log. Verify `EXPLAIN ANALYZE` on the query with `set_config('app.company_id', '<uuid>', true)`.
- **Action**:
  Verify composite index exists with `company_id` leading. If index is missing, add migration with `CREATE INDEX CONCURRENTLY`.

### Runbook 3: Outbox Relay Backlog
- **Symptoms**: `pending_outbox_events` count rising; in-app notifications delayed.
- **Diagnosis**:
  ```sql
  SELECT count(*), status FROM outbox_events WHERE status = 'pending';
  ```
- **Action**:
  1. Check `apps/worker` logs for Redis or connection errors.
  2. Restart worker container: `docker compose restart worker`.
  3. Failed outbox events are automatically marked with `error` and can be retried by setting `status = 'pending'`.

### Runbook 4: Emergency Step-Up & Session Revocation
- In case of compromised employee account:
  ```bash
  # Revoke all active sessions immediately via API:
  curl -X POST http://localhost:3000/api/v1/users/<userId>/revoke-sessions -H "Authorization: Bearer <ADMIN_TOKEN>"
  ```
