# Operational Runbook: Bank Advice File Generation & Re-issue

**Document ID**: `RB-PAY-04`  
**Target Roles**: Treasury Manager, Finance Operations, Payroll Accountant  
**Classification**: Financial Disbursement Procedure  

---

## 1. Security & Integrity Controls
Bank advice files drive financial disbursement and NEFT/RTGS transfers. Strict controls are enforced:
- **Maker-Checker Workflow**: Created by Maker (`payroll.bank.generate`), approved by Checker (`payroll.bank.approve`).
- **Encrypted Storage**: Advice files are encrypted with AES-256-GCM before storage in MinIO private buckets.
- **Single-Use Audited Download**: URLs expire in 5 minutes; every download generates an immutable audit entry in `audit_logs`.
- **Control Totals Check**: Total Net Pay in file MUST match the locked run `totalNet` to 0.00 paise.

---

## 2. Standard Generation Procedure
1. Confirm the payroll run is in `locked` or `published` status.
2. Navigate to **Payroll Operations > Disbursements > Generate Bank Advice**.
3. Select Bank Template (e.g., `HDFC_CORPORATE_NEFT`, `ICICI_BULK_PAYMENT`, `GENERIC_RTGS`).
4. Click **Generate Batch**. The engine parses bank account mappings and generates file version 1.
5. Checker performs Step-Up authentication and clicks **Approve Batch**.
6. Treasury Officer downloads the advice file via signed, short-lived URL and transmits to corporate banking portal.

---

## 3. Re-generation & Rejection Handling Procedure
If the bank rejects specific transactions (e.g., invalid account number, dormant account):

1. **Import Bank Response File**:
   - Navigate to **Disbursements > Import Confirmation**.
   - Upload bank return CSV. The engine marks failed employee payslips as `payment_status = 'failed'` or `'returned'`.
2. **Correction & Version Increment**:
   - HR updates the corrected employee bank details in Employee Master.
   - Click **Regenerate Bank Advice File**.
   - The engine generates a new version (e.g., `v2`), including only pending/failed disbursement items.
   - Control totals recalculated and re-verified.
3. Checker re-approves version 2 for secondary disbursement.
