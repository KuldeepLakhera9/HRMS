# Operational Runbook: Statutory Due Date Calendar & Filings

**Document ID**: `RB-PAY-05`  
**Target Roles**: Compliance Manager, Chartered Accountant, Payroll Specialist  
**Classification**: Statutory Governance Calendar  

---

## 1. Compliance Due Date Master Schedule (India)

| Statutory Return | Frequency | Due Date | Governing Authority | File / Format Produced |
| :--- | :--- | :--- | :--- | :--- |
| **Provident Fund (EPF)** | Monthly | **15th** of following month | EPFO (Unified Portal) | ECR Text File (`#~#` delimiter) |
| **Employee State Insurance (ESI)** | Monthly | **15th** of following month | ESIC Portal | Monthly Contribution Excel / CSV |
| **Professional Tax (PT)** | Monthly | **20th** (KA), **Last Day** (MH/TG) | State Commercial Taxes Dept | Form 5A / Monthly Challan Summary |
| **Labour Welfare Fund (LWF)** | Bi-annual / Annual | **15th Jan / 15th July** | State Labour Board | Contribution Summary Statement |
| **TDS Payment (Challan 281)** | Monthly | **7th** of following month | Income Tax Dept (NSDL/TRACES) | BSR / Challan Payment File |
| **TDS Quarterly Return (24Q)** | Quarterly | **31st July, 31st Oct, 31st Jan, 31st May** | TRACES Portal | Form 24Q Quarterly Text/FVU File |
| **Annual Tax Certificate** | Annual | **15th June** | Employee Tax Assessment | Form 16 Part A & Part B PDF |

---

## 2. Monthly Statutory Reconciliation Procedure
1. On the **1st to 5th** of each month, verify the prior month's regular payroll run is locked.
2. Navigate to **Statutory Compliance > Due Calendar & Filings**.
3. Generate the **PF ECR File**:
   - The engine produces the official EPFO format validated against active UANs and EPF/EPS wage caps.
4. Generate the **ESI Contribution Summary**:
   - Verifies all covered employees under the ₹21,000 threshold.
5. Reconcile **Challan Payments**:
   - Enter Challan Reference (CIN), BSR Code, and Payment Date upon portal settlement.
   - The system checks challan amount against locked payslip statutory lines. Any mismatch flags a compliance warning.
