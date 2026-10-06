# CA VALIDATION KIT: Payroll rules, golden cases, parallel run and sign-off

Audience: your Chartered Accountant (CA), Finance lead, HR lead, product owner. This is a working document, not legal or tax advice. **Every statutory value and interpretation below must be confirmed by your CA.** The software stores rates and rules as data so they can be corrected without code changes.

## 1. What the CA is asked to provide and approve
1. Approve the **rule data** (rates, ceilings, slabs, thresholds, effective dates, form labels) that will be entered in the rules admin screen.
2. Supply **expected results** for the golden test cases (section 5). These become the automated tests. The developers/AI must not compute the expected values themselves.
3. Review the **sample outputs** (payslip, PF/ESI/PT/TDS reports, bank file layout) before the first parallel run.
4. **Sign off** each parallel-run cycle and the final go-live.

## 2. Information to collect from the organization (before Sprint 4.1)
| Area | Needed |
|---|---|
| Entity | Legal form, PAN, TAN, address; PF establishment code and status; ESI code and status; Professional Tax and Labour Welfare Fund registrations per state; GST not needed for payroll |
| Pay policy | Pay cycle, pay day, paid-days basis (calendar, fixed 30, working days), proration of joiners/leavers, LOP method, rounding convention, treatment of negative net pay |
| Structures | Current salary structures by grade/category: components, formulas, which are taxable, which count for PF/ESI/gratuity, balancing component |
| Past data | Last 3 months of payroll output (register, payslips, PF/ESI/PT/TDS reports, bank file) for parallel-run and for the first golden cases |
| Tax practice | Default regime handling, declaration window and proof dates, previous-employer data process, HRA handling, perquisites (if any) |
| Benefits | Loans/advances policy, reimbursement policy and limits, statutory bonus/ex-gratia policy, gratuity policy, leave encashment policy, notice-period recovery/buyout |
| Banking | Bank(s), bulk-payment upload format specification (obtain the official template from the bank), salary debit account |
| Mid-year start | YTD earnings and tax deducted per employee up to the cutover month, previous-employer details |
| Exceptions | Any special cases: consultants/retainers, fixed-term staff, interns/stipends, employees above/below PF/ESI thresholds, contract staff paid through vendors (excluded from payroll) |

## 3. Rule catalog (to be entered as versioned rule sets)
Status legend: **CA-VERIFY** = must be confirmed with an official source and the CA before activation. "As of October 2026" notes come from public secondary reports and are listed only to point the CA to what changed; they are not authoritative.
| Rule set key | Controls | Data to capture | As of Oct 2026 (secondary reports, CA-VERIFY) |
|---|---|---|---|
| `TDS_IN` | Salary TDS | Regime slabs, standard deduction, rebate and marginal relief, surcharge slabs, cess, regime-wise deduction availability, declaration windows | Income-tax Act 2025 took effect 1 April 2026; salary TDS is under Section 392 (was 192); rates reported as largely unchanged; new regime is the default; salary for FY 2025-26 stays under the 1961 Act |
| `FORM_LABELS` | Names on screens and files | Annual certificate: Form 130 (was Form 16) for tax year 2026-27 onward; quarterly return: Form 138 (was 24Q); employee claims form: Form 124 (was 12BB); regime declaration: Form 122; keep FY 2025-26 labels for old-year data | Reported by several compliance guides; confirm against the Income-tax Rules, 2026 |
| `LABOUR_CODE_WAGES` | "Wages" definition for PF, gratuity, bonus | Whether enabled, floor percentage (reported 50%), list of excluded components, how excess is added back, state/central applicability | Four Labour Codes reported in force from 21 November 2025; uniform wages definition; confirm central/state rules status and your classification of each component |
| `PF_IN` | Provident Fund | Employee %, employer split (EPS/EPF), EDLI %, admin charge %, wage ceiling, contribute-on-actual option, VPF, ECR file layout, non-contributory days rules | Confirm all figures and the current EPFO ECR specification |
| `ESI_IN` | ESI | Eligibility wage threshold, employee and employer %, contribution periods, how eligibility continues within a period, rounding | Confirm all figures |
| `PT_<state>` | Professional Tax | Slabs by monthly gross, gender-specific rules, month-specific amounts, registration number, due dates | Per state; list the state(s) where employees work |
| `LWF_<state>` | Labour Welfare Fund | Employee/employer amounts, months, thresholds | Per state |
| `GRATUITY_IN` | Gratuity accrual and eligibility | Formula basis, eligibility years (permanent vs fixed-term), ceiling, accrual method | Fixed-term eligibility reported reduced to one year under the codes; confirm |
| `BONUS_IN` | Statutory bonus (if applicable) | Eligibility ceiling, wage ceiling, minimum/maximum %, calculation period | Confirm applicability to your entity |
| `LEAVE_ENCASHMENT` | Tax treatment of encashment (if used) | Exemption rules and limits | Confirm |
| `MIN_WAGE_<state>` (optional) | Minimum wage checks | Zone/skill rates | Used only for warnings |
Reference reads for the CA (secondary, may contain errors): cleartax.in/s/tds-and-tcs-changes-from-april-2026, indianhrm.com/payroll-compliance-updates/income-tax-act-2025-live, calcguru.in/labour-codes-payroll-changes, business-standard.com (impact of new Labour Codes, April 2026). Official sources to rely on: Income Tax Department portal, EPFO, ESIC, State labour/PT departments, Ministry of Labour & Employment notifications.

## 4. Questions to ask your CA (checklist)
1. Which Act and forms apply to each month in the first live year (FY 2025-26 old Act vs tax year 2026-27 new Act)? How should year-to-date from before April 2026 be treated?
2. Confirm the tax regime rules, slabs, standard deduction, rebate/marginal relief, surcharge and cess for tax year 2026-27, and which deductions remain in each regime.
3. How should TDS be projected when salary changes mid-year or bonuses are paid? Which method do you want for spreading shortfalls?
4. Confirm the Labour Code "wages" formulation, the list of excluded components, and whether your salary structures need to change before go-live.
5. PF: ceiling versus actual wage policy, EPS/EPF split, EDLI and admin charge treatment, NCP days handling, VPF, treatment of arrears.
6. ESI: threshold, eligibility continuity, rounding, treatment when wages cross the threshold mid-period.
7. Professional Tax and LWF for each state: slabs, months, registration, due dates.
8. Gratuity: eligibility and accrual method for permanent and fixed-term staff; provision accounting.
9. Statutory bonus and ex-gratia: applicability and calculation basis.
10. Mid-month joiners/leavers and LOP: preferred proration basis; rounding rules; arrears treatment (PF/ESI/TDS impact).
11. Reimbursements: which are non-taxable with bills, which are taxable; limits.
12. Loans and advances: interest perquisite considerations, recovery limits.
13. Notice period recovery/buyout and leave encashment tax and statutory treatment (Phase 6 will use these).
14. Which statutory returns/files will the CA file, and what data layout does the CA need from the system?
15. Review of the sign-off process (section 7) and the audit trail you need to retain.
16. Data retention for payroll and statutory records.

## 5. Golden cases: how to provide them
Provide at least **50** real, anonymized or synthetic employee-month cases covering the scenarios below. For each, give inputs and the **expected line-by-line result computed by you (CA/Finance)**. The developers convert them into JSON tests.
```
{
  "id": "G-017",
  "description": "Mid-month joiner, LOP 2 days, PF on actual wage under ceiling",
  "ruleSnapshot": { "TDS_IN": "version-id", "PF_IN": "version-id", "ESI_IN": "...", "PT_<state>": "..." },
  "employee": { "joinDate": "2026-10-11", "state": "<state>", "regime": "new", "employmentType": "permanent" },
  "salary": { "ctcAnnual": 0, "structure": "S1", "effectiveFrom": "2026-10-11" },
  "attendance": { "calendarDays": 31, "paidDays": 0, "lopDays": 2 },
  "inputs": [ { "type": "bonus", "amount": 0 } ],
  "ytd": { "gross": 0, "tdsDeducted": 0 },
  "expected": { "lines": [ { "code": "BASIC", "amount": "0.00" } ], "gross": "0.00", "deductions": "0.00", "net": "0.00", "employerCost": "0.00", "tds": "0.00" },
  "notes": "Source: CA working sheet, row 12"
}
```
(The zeros above are placeholders in a template. Replace with real values supplied by the CA. Never copy numbers from the software's own output.)
Required scenarios (tick when provided):
- [ ] Full month, standard structure, each regime
- [ ] Mid-month joiner and mid-month exit
- [ ] LOP days (various counts), zero paid days, unpaid leave across month end
- [ ] Salary revision effective mid-month; revision with arrears for previous months (PF/ESI/TDS effect)
- [ ] PF: wage below, at and above the ceiling; contribute-on-actual option; VPF
- [ ] ESI: below threshold, crossing threshold mid-period, continuity within contribution period
- [ ] Professional Tax: normal month, the special month, women/men differences where applicable, each state in use
- [ ] LWF month
- [ ] Bonus month with TDS spike; one-time incentive; arrears payout
- [ ] Regime change at declaration; declared deductions verified vs unverified (old regime)
- [ ] Previous employer income and tax deducted
- [ ] Reimbursement (non-taxable) and taxable perquisite
- [ ] Loan EMI recovery; advance recovery limit; negative net situation
- [ ] Labour Code wages floor: structure below 50% (add-back) and above
- [ ] Rounding edge cases (half paise, per-component rounding)
- [ ] Financial-year boundary (March to April under the new Act, YTD reset)
- [ ] Mid-year go-live with opening balances (YTD import) and TDS projection
- [ ] Gratuity provision for permanent and fixed-term employee
- [ ] Off-cycle bonus run; correction run after an error
- [ ] Senior citizen/other age-based rules if employees are affected
- [ ] Employees excluded from PF/ESI by policy; international worker or non-resident if any

## 6. Parallel-run protocol (minimum 2 consecutive cycles, 3 preferred)
1. **Before cycle 1**: rule sets entered and approved (maker-checker), CA reviews rule data and sample outputs, golden cases at 100%, opening balances imported and reconciled, structures loaded, salary assignments approved by Finance.
2. **Each cycle**: (a) run the current process as usual and keep it as the source of truth for actual payments; (b) run the new system on identical inputs; (c) import the old output into the reconciliation tool and map columns; (d) review every difference: rounding (within tolerance), input difference, rule difference, engine bug, source error, timing; (e) fix causes, recalculate, repeat until zero unexplained differences; (f) CA and Finance sign the cycle.
3. **Tolerance**: default 1 rupee per line, agreed in writing; rounding differences are explained, not ignored.
4. **Evidence kept**: reconciliation report, list of fixes, signed sign-off form, rule versions used, run hash.
5. **Go/no-go meeting** after the last parallel cycle: criteria in section 7.

## 7. Sign-off form (copy per cycle and for final go-live)
| Item | CA | Finance lead | HR lead | Product owner |
|---|---|---|---|---|
| Rule sets and form labels reviewed and approved (versions: ...) | [ ] | [ ] | n/a | [ ] |
| Golden cases provided and passing (count: ...) | [ ] | [ ] | n/a | [ ] |
| Payslip format approved | n/a | [ ] | [ ] | [ ] |
| Bank file validated in a dry run with the bank | n/a | [ ] | n/a | [ ] |
| PF/ESI/PT/LWF/TDS outputs reconciled and usable for filing | [ ] | [ ] | n/a | n/a |
| Parallel cycle(s) with zero unexplained differences (cycles: ...) | [ ] | [ ] | [ ] | [ ] |
| Opening balances reconciled (mid-year go-live) | [ ] | [ ] | n/a | n/a |
| Segregation-of-duties configuration approved | [ ] | [ ] | [ ] | [ ] |
| Backup/restore and run-hash verification demonstrated | n/a | n/a | n/a | [ ] |
| **Go-live approved** (name, date, signature) | | | | |

## 8. Mid-year cutover checklist
- [ ] Choose the cutover month with the CA (consider quarter boundaries for returns)
- [ ] Final old-process run closed; YTD per employee extracted and validated
- [ ] Opening balances imported, reconciled to the old reports, signed by Finance
- [ ] Declarations and regime choices collected (or carried over) for the year
- [ ] First live run scheduled with Finance and CA on standby; bank file dry-run done
- [ ] Rollback plan agreed (continue the old process for that cycle, discard the new run before publish)
- [ ] Employee communication sent (how to view payslips, declarations, support contact)
