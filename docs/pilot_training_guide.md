# OrgHub HRMS: Pilot Training & User Guide

Welcome to OrgHub HRMS! This guide provides role-based walkthroughs for Employees, Managers, and HR Administrators to make the most of the Phase 3 platform during our operational pilot.

---

## Part 1: Employee Self-Service Guide

### 1. Daily Attendance & Clocking In/Out
- **Mobile Clock-In**:
  1. Open the OrgHub Mobile App on your device.
  2. Ensure Location Services (GPS) are enabled.
  3. The home screen detects your nearest assigned work location.
  4. Tap the large green **Punch In** button.
  5. The app verifies your geofence and registers your timestamp in `< 300 ms`.
- **Office Turnstile Punch**:
  - Scan your biometric fingerprint or RFID badge at any physical office entrance gate.
- **Web Browser Punch**:
  - If working from home or approved for remote attendance, click **Clock In** on the top header of the web portal.

### 2. Applying for Leave
1. Navigate to **Leave & Time Off** (`/leave`) in the sidebar.
2. Review your balance cards: **Earned Leave**, **Casual Leave**, and **Sick Leave**.
3. Click **Apply for Leave**.
4. Select the leave type and choose your date range.
5. Watch the **Live Preview** update instantly:
   - It will display total calendar days, holidays excluded, net leave balance after approval, and any sandwich rule notifications.
6. Provide a reason and click **Submit Request**.
7. Your manager will be notified immediately.

### 3. Helpdesk & Company Announcements
- **Announcements**: Check the **Announcements** feed (`/announcements`) for important company notices, policy updates, and town hall schedules.
- **Helpdesk**: If you encounter an issue or have a query regarding attendance or payroll, navigate to **Helpdesk** (`/helpdesk`), click **New Ticket**, choose the category, and submit. You can chat directly with HR in the ticket thread.

---

## Part 2: Manager Guide

### 1. Reviewing & Approving Leave Requests
1. Navigate to **Approvals Inbox** (`/workflow/inbox`) or look at the notifications bell.
2. Select any pending leave request.
3. Review:
   - Requested dates and reason.
   - Team calendar clash preview (shows other team members on leave during the same dates).
4. Click **Approve** or **Reject** (with mandatory reason). The employee receives immediate notification.

### 2. Attendance Exceptions & Regularization
1. Open the **Exceptions Inbox**.
2. View employees with missing clock-outs, late marks, or overtime.
3. If an employee submits an attendance regularization request with a valid reason, click **Approve** to recalculate the day automatically.

---

## Part 3: HR Administrator Guide

### 1. Reports Catalog & Async Export
1. Navigate to **Reports & Analytics** (`/reports`).
2. Choose from any of the 8 enterprise standard reports:
   - Daily Attendance Summary
   - Monthly Attendance Register (Muster Roll)
   - Attendance Exceptions
   - Leave Balances Snapshot
   - Leave Usage & Trends
   - Headcount & Demographics
   - Joiners & Leavers
   - Overtime Summary
3. Select date range, department, and filters.
4. Click **Preview (Top 50)** for instant inspection.
5. Click **Export CSV** or **Export XLSX** for asynchronous background streaming directly to MinIO private storage.

### 2. Data Migration Hub
1. Navigate to **Data Migration** (`/migration`).
2. Download sample CSV templates for **Opening Leave Balances** or **Historical Attendance**.
3. Upload your populated CSV to get an instant **Preview & Validation Analysis** with row counts and error diagnostics.
4. Click **Confirm & Import** to write immutable ledger records.
5. If errors are detected, roll back any batch with one click using **Revert Batch**.

### 3. Pilot Telemetry & CSAT
1. Navigate to **Pilot Telemetry** (`/pilot/metrics`).
2. Track overall **Adoption Rate**, punch channel split (Mobile vs Web vs Kiosk), regularization rates, and average CSAT score.
3. Read real-time feedback submissions and take action to ensure a smooth pilot!
