# Runbook: Feature Flag Rollback & Emergency Kill-Switch

## 1. Overview
OrgHub HRMS utilizes dynamic tenant-level and user/department-targeted feature flags stored in `feature_flags` to control progressive rollouts of Phase 3 capabilities:
- `leave_encashment_v1`: Cash-out calculation on exit.
- `geofence_strict_enforcement`: Rejection of punches outside work location radius.
- `helpdesk_sla_escalation`: Automated notifications for tickets breaching SLA.
- `ai_report_summarizer`: Automated textual insights on generated reports.

This runbook describes the procedure to instantly disable a problematic feature flag or roll it back safely without code deployments or service restarts.

---

## 2. Trigger Conditions
- Rapid spike in client error rates (`HTTP 500` or uncaught React errors) following flag enablement.
- Reports of inaccurate calculations in production (e.g., negative balance calculations or erroneous attendance penalties).
- Critical security or permission bypass discovered in an unreleased feature.

---

## 3. Immediate Action: Emergency Kill-Switch

### Option A: Via Admin UI (Fastest)
1. Navigate to `/admin/feature-flags` or `/pilot/metrics`.
2. Locate the flag (e.g., `geofence_strict_enforcement`).
3. Toggle the switch to **Disabled**.
4. Changes take effect across API servers within `< 5 seconds` (cached in Redis with short TTL).

### Option B: Via Management CLI
```bash
# Disable flag globally for a tenant
pnpm --filter @hrms/core run exec:feature-flag \
  --companyId="01912345-6789-7abc-def0-123456789abc" \
  --key="geofence_strict_enforcement" \
  --enabled=false
```

### Option C: Via Direct SQL Emergency Command
If the admin UI and CLI are unreachable:
```sql
-- Connect via psql as hrms_app role
UPDATE feature_flags 
SET 
  is_enabled = false,
  updated_at = CURRENT_TIMESTAMP
WHERE company_id = '01912345-6789-7abc-def0-123456789abc' 
  AND key = 'geofence_strict_enforcement';

-- Flush Redis feature flag cache keys immediately
-- redis-cli: DEL "flags:01912345-6789-7abc-def0-123456789abc:*"
```

---

## 4. Partial Rollback (Targeting Specific Departments)
Instead of a global shutdown, you can restrict the feature to an internal testing department:

```sql
UPDATE feature_flags
SET rules = '{"departments": ["dept-it-internal-uuid"]}'::jsonb,
    updated_at = CURRENT_TIMESTAMP
WHERE company_id = '01912345-6789-7abc-def0-123456789abc'
  AND key = 'leave_encashment_v1';
```

---

## 5. Post-Rollback Verification
1. Verify client response:
   ```bash
   curl -X GET https://hrms.internal/api/v1/pilot/metrics \
     -H "Authorization: Bearer $USER_TOKEN"
   ```
2. Monitor Sentry / Pino logs to ensure exceptions subside.
3. Inform the pilot user group via the Announcements hub that the feature has been temporarily withdrawn for maintenance.
4. Record an Incident Post-Mortem in `docs/decisions/`.
