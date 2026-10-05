# Runbook: Report Generation & Async Export Failure

## 1. Overview
The **Reports Framework** supports both synchronous previews (limited to 100 rows) and asynchronous streaming exports (CSV and XLSX) processed by background workers on BullMQ. Export artifacts are uploaded to private MinIO / S3 buckets and downloaded by users via short-lived signed URLs.

- **Queue**: `report-export` (Redis / BullMQ).
- **Concurrency**: 3 worker processes.
- **Storage**: MinIO / S3 Bucket `hrms-reports-private`.
- **Retention**: Exported files expire after 7 days via S3 lifecycle policy.

---

## 2. Detection & Alerts
- **Prometheus Metric**: `hrms_report_export_duration_seconds > 60` or `hrms_report_export_failures_total > 0`
- **Alert**: `ReportExportFailed`, `MinIOStorageUnreachable`, or `ReportTimeoutError`
- **Symptoms**:
  - User sees report status as `failed` in the Report History table.
  - Download link fails with HTTP 403 (expired signed URL) or HTTP 500.

---

## 3. Diagnostic Steps

### Step 1: Check Report Run Record in PostgreSQL
```sql
SELECT 
  id,
  company_id,
  report_slug,
  status,
  error_message,
  file_url,
  created_at,
  completed_at
FROM report_runs
WHERE status = 'failed' OR (status = 'processing' AND created_at < NOW() - INTERVAL '30 minutes')
ORDER BY created_at DESC
LIMIT 10;
```

### Step 2: Check MinIO Storage Availability
```bash
# Verify MinIO connectivity
curl -I http://$MINIO_ENDPOINT/minio/health/live

# Check storage disk space
docker exec hrms-minio df -h /data
```

### Step 3: Inspect Worker Logs for Memory or Timeout Errors
```bash
docker logs hrms-worker --tail 200 | grep "report.export"
```

---

## 4. Remediation Procedures

### Scenario A: MinIO Unreachable or Network Glitch
1. Verify Docker container status:
   ```bash
   docker ps | grep hrms-minio
   ```
2. If down or unhealthy:
   ```bash
   docker restart hrms-minio
   ```
3. Restart worker queue processing:
   ```bash
   docker restart hrms-worker
   ```

### Scenario B: Database Statement Timeout on Large Export (> 20,000 Rows)
If a complex report (e.g., `daily_attendance_summary` over 12 months) hits the query `statement_timeout`:
1. Stream the export with chunked keyset cursor iteration rather than loading all rows into RAM.
2. Recommend the user narrow down the date filter:
   ```json
   {
     "startDate": "2026-09-01",
     "endDate": "2026-09-30"
   }
   ```
3. If necessary for annual audits, temporarily increase `statement_timeout` for the export worker role:
   ```sql
   ALTER ROLE hrms_app SET statement_timeout = '120s';
   ```

### Scenario C: Failed Job Retry
Failed report runs can be retried directly from the BullMQ failed set:
```bash
# Retry failed jobs in queue
pnpm --filter @hrms/worker run exec:retry-failed-reports
```

---

## 5. Post-Remediation Verification
1. Navigate to `/reports` in the Web UI.
2. Select the report that failed and click **Export CSV**.
3. Verify that the task completes in `< 30 seconds` and yields a downloadable CSV.
4. Verify file signature and headers.
