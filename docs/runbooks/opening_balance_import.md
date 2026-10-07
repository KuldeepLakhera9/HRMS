# Operational Runbook: Opening Balance & YTD Migration

**Document ID**: `RB-PAY-07`  
**Target Roles**: Migration Lead, Finance Ops, Implementation Consultant  
**Classification**: Go-Live Migration Procedure  

---

## 1. Overview & Purpose
When an enterprise transitions to OrgHub HRMS mid-financial-year (e.g., October go-live after April–September ran in a legacy HRMS), prior earnings, PF, PT, and TDS must be imported as **Opening Balances** to ensure:
- Accurate year-end income tax TDS calculations (avoiding double standard deductions or bracket miscalculations).
- Correct Form 16 Part B annual certificate generation.
- Correct Section 80C, 80D, and statutory PF wage ceilings.

---

## 2. File Format & Column Mapping
The opening balance import accepts RFC 4180 CSV files with the following structure:
```csv
empCode,financialYear,grossEarnings,epfWage,epfEmployee,vpf,pt,esiWage,esiEmployee,tdsDeducted,previousEmployerGross,previousEmployerTds
EMP001,2026-2027,300000.00,90000.00,10800.00,0.00,1200.00,0.00,0.00,32000.00,0.00,0.00
EMP002,2026-2027,450000.00,90000.00,10800.00,0.00,1200.00,0.00,0.00,64000.00,150000.00,12000.00
```

---

## 3. Import & Validation Procedure
1. Navigate to **Payroll Settings > Data Migration > Opening Balances**.
2. Upload legacy YTD CSV file.
3. The `OpeningBalanceService.importOpeningBalances()` validates:
   - Valid active employee codes in the tenant.
   - Financial year format (`YYYY-YYYY`).
   - Non-negative decimal numbers for all monetary values.
   - Math consistency: Gross Earnings $\ge$ Tax Deducted at Source.
4. **Staging Review**:
   - Preview imported totals and employee count.
   - Any validation error halts the import, reporting specific row and column errors.
5. **Commit**:
   - Commit writes records to `payroll_opening_balances` and populates `payroll_ytd`.
6. **Revert Contingency**:
   - If bad legacy data was imported, use `revertImport(importJobId)` to atomically roll back the entire batch.
