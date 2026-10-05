# Runbook: Upstream Hardware Attestation Outage Response

## 1. Overview
HRMS Mobile uses Google Play Integrity (Android) and Apple DeviceCheck (iOS) to attest that incoming punch requests originate from genuine, non-tampered, and unrooted hardware.

If Google or Apple experience global infrastructure outages (e.g. Google Play Integrity API returning HTTP 500 or 503), legitimate employee punches could be rejected or fail verification. This runbook details the incident response protocol, emergency degraded mode activation, and post-recovery reconciliation.

---

## 2. Detection & Alerting
- **Alert Rule**: `HighAttestationFailureRate`
  - Condition: Attestation failure rate $> 15\%$ across $\ge 20$ distinct mobile clients over a 5-minute sliding window.
  - Severity: **P1 - Critical**.
- **Triage Checklist**:
  1. Check [Google Play Status Dashboard](https://status.play.google.com) and [Apple Developer System Status](https://developer.apple.com/system-status/).
  2. Inspect server error logs for attestation response status codes:
     ```bash
     grep "attestation_verification_failed" /var/log/hrms/app.log | jq .
     ```
  3. If failures are isolated to a single employee or device, treat as localized device tampering or rooted device (NOT an upstream outage).
  4. If failures span across hundreds of devices with error code `UPSTREAM_UNAVAILABLE` or `HTTP 503`, declare an **Attestation Outage Incident**.

---

## 3. Emergency Action: Enable Degraded Mode

To prevent thousands of employees from being blocked at office turnstiles and gates during a morning rush, activate **Degraded Attestation Mode**.

In Degraded Mode:
- Punches are accepted using secondary trust factors (registered hardware ID, GPS geofence, and local signature).
- Attestation verification is queued asynchronously for later re-verification once upstream services recover.
- Punches accepted in degraded mode are tagged with `attestation_status: 'degraded_accepted'` for auditability.

### Activation Procedure
Set the dynamic runtime flag via Redis or Management API:

```bash
# Option 1: Via Redis CLI (Immediate across all app instances)
redis-cli SET "hrms:config:attestation_bypass_active" "true" EX 7200 # 2 hour auto-expiry safety

# Option 2: Via Admin API
curl -X POST https://hrms.internal/api/v1/system/emergency-config \
  -H "Authorization: Bearer $SUPERADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "attestation_mode",
    "value": "degraded_bypass",
    "reason": "Upstream Google Play Integrity outage per incident #INC-4412",
    "ttlMinutes": 120
  }'
```

Verify in server logs that the runtime configuration has been updated:
`[System Config] Attestation degraded mode ENABLED. Secondary trust factors enforced.`

---

## 4. Post-Recovery Procedure & Reconciliation
Once Google/Apple status dashboards confirm full service restoration:

1. **Disable Degraded Mode**:
   ```bash
   redis-cli DEL "hrms:config:attestation_bypass_active"
   ```
2. **Audit Degraded Punches**:
   Query all punches recorded during the outage window:
   ```sql
   SELECT
     p.id, p.company_id, p.employee_id, p.punch_time, p.source,
     p.latitude, p.longitude, p.is_inside_geofence
   FROM attendance_punches p
   WHERE p.created_at >= '<outage_start_time>'
     AND p.created_at <= '<outage_end_time>'
     AND p.source = 'mobile';
   ```
3. **Run Anomaly Detection**:
   Inspect whether any punches within the outage window exhibit anomalous GPS jumps or outside-geofence coordinates. Flag anomalous records in `attendance_exceptions` for manager review.
4. **Publish Incident Post-Mortem**:
   Document total duration, number of affected punches, and vendor incident ticket references.
