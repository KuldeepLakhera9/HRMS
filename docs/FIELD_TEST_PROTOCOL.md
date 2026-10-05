# Field Test Protocol: Mobile Geofence & Device Attestation (P2-QA-04)

## 1. Overview & Objective
This document outlines the standard operational protocol for field-testing the HRMS Mobile Attendance client across field sites, factory gates, and branch offices. The objective is to verify real-world robustness under hostile conditions: GPS drift, poor cellular connectivity, developer mock location attempts, and biometric device integration.

---

## 2. Test Apparatus & Setup
- **Target Devices**:
  - Android: Google Pixel / Samsung Galaxy running Android 12+ with Google Play Services.
  - iOS: iPhone 12+ running iOS 16+.
- **Software Build**: HRMS Mobile `v0.1.0-p2.4` (Production build).
- **Environment**: Staging / Production instance with company geofences and shift policies configured.
- **Diagnostic Mode**: Tap the app build number 7 times on the home screen to reveal the secret **Field Diagnostics** tab.

---

## 3. Test Scenarios & Execution Matrix

### Test 1: Geofence Boundary & Precision Test
- **Objective**: Ensure punches are strictly gated within the geofence perimeter (default 100m) and that GPS accuracy requirements ($\le 50\text{m}$) are enforced.
- **Steps**:
  1. **Zone A (Inner Campus - 10m from center)**: Clock in. Verify punch succeeds immediately with `isInsideGeofence: true` and distance $\le 20\text{m}$.
  2. **Zone B (Boundary Edge - 95m from center)**: Clock in/out. Verify punch succeeds with `isInsideGeofence: true`.
  3. **Zone C (Outside Fence - 130m from center)**: Clock in. Verify punch is rejected or tagged as an exception (`geofence_violation`) with clear UI feedback.
  4. **Degraded GPS (Underground Basement / Metal Roof)**: If GPS accuracy reports $> 50\text{m}$ (e.g. $\pm 75\text{m}$), verify the app warns "GPS signal too weak for attendance verification" and prevents clock-in until a reliable fix is acquired.

### Test 2: Anti-Spoofing & Mock Location Rejection
- **Objective**: Verify that simulated locations from Mock Location apps or ADB are flagged and blocked.
- **Steps**:
  1. Enable "Developer Options" on an Android test device.
  2. Select a mock location app (e.g., *Fake GPS Location*) as the mock provider.
  3. Set coordinate directly inside the office turnstile.
  4. Attempt to punch in.
  5. **Pass Criteria**: Mobile app detects `isMock === true` or Play Integrity attestation reports `FAILED`. The punch request is blocked or immediately quarantined on the server with reason `mock_location_detected`.

### Test 3: Offline Queue & Connectivity Blackout Replay
- **Objective**: Ensure employee attendance is never lost in basements, elevators, or dead zones, and synchronization preserves strict FIFO order.
- **Steps**:
  1. Place mobile device into Airplane Mode (Wi-Fi and Cellular off).
  2. Perform an IN punch. Verify local confirmation: "Stored in offline queue (1 pending)".
  3. Wait 5 minutes. Perform an OUT punch. Verify "Stored in offline queue (2 pending)".
  4. Disable Airplane Mode. Observe automated sync in background or tap "Flush / Sync Queue" in Diagnostics screen.
  5. **Pass Criteria**:
     - Punches synchronize in strict chronological order (IN first, OUT second).
     - Client-generated UUIDv7 idempotency keys guarantee zero duplicate punches.
     - Server day-engine correctly computes work duration matching the local device event timestamps.

### Test 4: Hardware Attestation (Play Integrity / DeviceCheck)
- **Objective**: Prevent unauthorized rooted devices, emulators, or reverse-engineered API bots.
- **Steps**:
  1. Run mobile app on standard non-rooted OEM device. Verify Diagnostics screen shows `MEETS_STRONG_INTEGRITY` or `MEETS_DEVICE_INTEGRITY`.
  2. Attempt API request with an altered or missing attestation token.
  3. **Pass Criteria**: Server rejects unregistered or revoked device hardware identifiers with HTTP 403 Forbidden.

---

## 4. Diagnostic Bundle Collection
At the completion of each field test:
1. Open the **Diagnostics** screen in the mobile app.
2. Tap **Generate Diagnostics Dump**.
3. Export the JSON telemetry bundle.
4. Save the bundle to `diagnostics_dump_<device_id>_<timestamp>.json`.
5. Run the verification script:
   ```bash
   pnpm exec tsx scripts/analyze-diagnostics.ts diagnostics_dump_*.json
   ```

---

## 5. Acceptance Thresholds
| Metric | Acceptance Threshold |
| :--- | :--- |
| Geofence False Rejection Rate (within boundary) | $< 0.1\%$ |
| Geofence False Acceptance Rate (beyond 110m) | $0.0\%$ |
| Mock Location Detection Rate | $100\%$ |
| Offline Sync Data Loss Rate | $0.0\%$ |
| Average Punch Ingest Latency (p95) | $< 400\text{ ms}$ |
| Battery Consumption per 8h Shift | $< 2.5\%$ |
