# Runbook: PostgreSQL Table Partition Maintenance

## 1. Overview
High-volume append-only tables (`attendance_punches` and `audit_logs`) use monthly range partitioning on PostgreSQL to guarantee high write throughput, bounded index sizes, and rapid range scans without sequential table bloat.

- **Partition Key**: `punch_time` (UTC timestamp) for punches; `created_at` (UTC timestamp) for audit logs.
- **Partition Naming Convention**:
  - `attendance_punches_yYYYY_mMM` (e.g. `attendance_punches_y2026_m10`)
  - `audit_logs_yYYYY_mMM` (e.g. `audit_logs_y2026_m10`)
- **Retention Policy**: Active online for 24 months; archived to MinIO S3 parquet after 24 months.

---

## 2. Partition Pre-Creation Schedule
Future partitions must be created at least **30 days in advance** so that writes occurring around month transitions never fail on missing table partitions.

### Automated Cron Job
A scheduled cron job executes on the 20th of every month:
```sql
SELECT cron.schedule('0 0 20 * *', $$SELECT hrms_create_next_partitions();$$);
```

### Manual Pre-Creation Procedure
To manually inspect or create partitions for the next 3 months:

```sql
-- Connect as owner role
-- Example: Creating partitions for November and December 2026

-- Attendance Punches for Nov 2026
CREATE TABLE IF NOT EXISTS attendance_punches_y2026_m11
  PARTITION OF attendance_punches
  FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');

-- Attendance Punches for Dec 2026
CREATE TABLE IF NOT EXISTS attendance_punches_y2026_m12
  PARTITION OF attendance_punches
  FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');

-- Audit Logs for Nov 2026
CREATE TABLE IF NOT EXISTS audit_logs_y2026_m11
  PARTITION OF audit_logs
  FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');

-- Audit Logs for Dec 2026
CREATE TABLE IF NOT EXISTS audit_logs_y2026_m12
  PARTITION OF audit_logs
  FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');
```

---

## 3. Partition Verification & Health Checks
Check current partitions and row distributions:
```sql
SELECT
    inhrelid::regclass AS partition_name,
    pg_size_pretty(pg_total_relation_size(inhrelid)) AS total_size,
    pg_stat_get_live_tuples(inhrelid) AS approx_row_count
FROM pg_inherits
WHERE inhparent = 'attendance_punches'::regclass
ORDER BY partition_name;
```

---

## 4. Archival & Detachment Procedure (Cold Storage)
Partitions older than 24 months are detached and dumped:
1. **Export partition to Parquet / CSV**:
   ```bash
   pg_dump -t attendance_punches_y2024_m09 hrms_db | gzip > /backups/attendance_punches_y2024_m09.sql.gz
   aws s3 cp /backups/attendance_punches_y2024_m09.sql.gz s3://hrms-archive-vault/partitions/
   ```
2. **Detach from parent table**:
   ```sql
   ALTER TABLE attendance_punches DETACH PARTITION attendance_punches_y2024_m09;
   ```
3. **Drop table after archival confirmation**:
   ```sql
   DROP TABLE attendance_punches_y2024_m09;
   ```
