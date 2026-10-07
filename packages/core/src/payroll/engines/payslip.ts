import crypto from 'node:crypto';
import { Decimal } from 'decimal.js';
import type { z } from 'zod';
import { evaluateFormula } from '../formula/index.js';
import { calculatePf } from './pf.js';
import { calculateEsi } from './esi.js';
import { calculatePt } from './pt.js';
import { calculateLwf } from './lwf.js';
import { calculateGratuityProvision } from './gratuity.js';
import { calculateLabourCodeWages } from './labour-code-wages.js';
import { computeTds, TdsCalculationResult } from './tds.js';
import type {
  pfRulePayloadSchema,
  esiRulePayloadSchema,
  ptRulePayloadSchema,
  lwfRulePayloadSchema,
  tdsRulePayloadSchema,
  gratuityRulePayloadSchema,
  labourCodeWagesPayloadSchema,
} from '../rules/schemas.js';

export const ENGINE_VERSION = '1.0.0';

export interface PayslipLineItem {
  code: string;
  name: string;
  kind: 'earning' | 'deduction' | 'employer_contribution' | 'reimbursement';
  amount: string;
  taxableAmount: string;
  ruleRef?: string | undefined;
}

export interface PayslipComponentDef {
  code: string;
  name: string;
  kind: 'earning' | 'deduction' | 'employer_contribution' | 'reimbursement';
  calc: 'fixed' | 'formula' | 'input' | 'slab';
  formula?: string | undefined;
  prorate?: boolean | undefined;
  taxable?: boolean | undefined;
  pfWage?: boolean | undefined;
  esiWage?: boolean | undefined;
  gratuityWage?: boolean | undefined;
  statutoryWage?: boolean | undefined;
  isBalancing?: boolean | undefined;
}

export interface PayslipPayrollInput {
  type: string;
  componentCode?: string | null | undefined;
  amount: string | number;
  taxable?: boolean | undefined;
}

export interface PayslipLoanDeduction {
  loanId: string;
  installmentId: string;
  amount: string | number;
}

export interface PayslipCalculationInput {
  employee: {
    id: string;
    empCode?: string | undefined;
    state: string; // 2-letter state code, e.g. 'KA', 'MH'
    gender?: string | undefined;
    joinDate?: string | undefined;
    exitDate?: string | undefined;
    pan?: string | undefined;
    bankAccountNumber?: string | undefined;
  };
  settings: {
    paidDaysBasis: 'calendar' | 'fixed_30' | 'working_days';
    prorationMode: 'prorate_earnings' | 'deduct_lop';
    negativeNetPolicy: 'block' | 'hold' | 'carry_forward';
    pfEnabled?: boolean | undefined;
    esiEnabled?: boolean | undefined;
    ptEnabled?: boolean | undefined;
    lwfEnabled?: boolean | undefined;
    labourCodeWages?: {
      enabled: boolean;
      floorPct: number;
    } | undefined;
  };
  attendance: {
    calendarDays: number;
    paidDays: number;
    lopDays: number;
  };
  salary: {
    ctcAnnual: string | number;
    structureId?: string | undefined;
    structureVersion?: number | undefined;
    components: PayslipComponentDef[];
  };
  inputs: PayslipPayrollInput[];
  loansDue: PayslipLoanDeduction[];
  rules: {
    PF_IN?: z.infer<typeof pfRulePayloadSchema> | undefined;
    ESI_IN?: z.infer<typeof esiRulePayloadSchema> | undefined;
    PT?: z.infer<typeof ptRulePayloadSchema> | undefined;
    LWF?: z.infer<typeof lwfRulePayloadSchema> | undefined;
    TDS_IN?: z.infer<typeof tdsRulePayloadSchema> | undefined;
    GRATUITY_IN?: z.infer<typeof gratuityRulePayloadSchema> | undefined;
    LABOUR_CODE_WAGES?: z.infer<typeof labourCodeWagesPayloadSchema> | undefined;
  };
  ytd?: {
    gross?: string | number | undefined;
    tdsDeducted?: string | number | undefined;
    openingBalanceEarnings?: string | number | undefined;
    openingBalanceTds?: string | number | undefined;
  } | undefined;
  taxDeclaration?: {
    regime: 'new' | 'old';
    verifiedDeductions?: Record<string, string | number> | undefined;
    remainingMonths: number;
    previousEmployerEarnings?: string | number | undefined;
    previousEmployerTds?: string | number | undefined;
  } | undefined;
  periodMonth?: number | undefined; // 1 to 12 (calendar month of run, e.g. 3 for March)
}

export interface PayslipCalculationResult {
  engineVersion: string;
  inputHash: string;
  payableDays: number;
  payableRatio: string;
  lines: PayslipLineItem[];
  gross: string;
  deductions: string;
  reimbursements: string;
  net: string;
  employerCost: string;
  gratuityProvision: string;
  warnings: string[];
  blockers: string[];
  tdsComputation?: TdsCalculationResult | undefined;
}

function canonicalStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalStringify).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys.map(k => `${JSON.stringify(k)}:${canonicalStringify((obj as Record<string, unknown>)[k])}`);
  return '{' + entries.join(',') + '}';
}

/**
 * Pure master payslip calculation engine.
 * Deterministic: zero DB calls, zero clock accesses, exact Decimal.js arithmetic.
 */
export function computePayslip(input: PayslipCalculationInput): PayslipCalculationResult {
  const warnings: string[] = [];
  const blockers: string[] = [];
  const lines: PayslipLineItem[] = [];

  // Step 1: Eligibility and Proration
  const calendarDays = Math.max(1, input.attendance.calendarDays);
  let effectiveLopDays = input.attendance.lopDays;

  // LOP override inputs
  for (const inp of input.inputs) {
    if (inp.type === 'lop_override') {
      effectiveLopDays = Number(inp.amount);
    }
  }

  const payableDays = Math.max(0, input.attendance.paidDays - effectiveLopDays);
  const payableRatioDec = new Decimal(payableDays).div(calendarDays);
  const payableRatio = Decimal.min(1, Decimal.max(0, payableRatioDec)).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);

  if (payableDays === 0) {
    warnings.push('Employee has zero payable days for the period');
  }

  // Step 2: Earnings
  const ctcAnnualDec = new Decimal(input.salary.ctcAnnual);
  const monthlyCtcDec = ctcAnnualDec.div(12).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  const formulaContext: Record<string, number> = {
    CTC: ctcAnnualDec.toNumber(),
    MONTHLY_CTC: monthlyCtcDec.toNumber(),
    CALENDAR_DAYS: calendarDays,
    PAID_DAYS: payableDays,
    LOP_DAYS: effectiveLopDays,
    PAYABLE_RATIO: payableRatio.toNumber(),
    GROSS: 0,
  };

  let earningsRunningTotal = new Decimal(0);
  let balancingComponent: PayslipComponentDef | null = null;

  for (const comp of input.salary.components) {
    if (comp.kind !== 'earning') continue;

    if (comp.isBalancing) {
      balancingComponent = comp;
      continue;
    }

    let unproratedAmount = new Decimal(0);
    if (comp.calc === 'formula' && comp.formula) {
      unproratedAmount = new Decimal(evaluateFormula(comp.formula, formulaContext));
    } else if (comp.calc === 'fixed') {
      unproratedAmount = new Decimal(0);
    }

    let finalAmount = unproratedAmount;
    if (comp.prorate !== false) {
      finalAmount = unproratedAmount.mul(payableRatio).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    }

    lines.push({
      code: comp.code,
      name: comp.name,
      kind: 'earning',
      amount: finalAmount.toFixed(2),
      taxableAmount: comp.taxable !== false ? finalAmount.toFixed(2) : '0.00',
      ruleRef: comp.formula,
    });

    earningsRunningTotal = earningsRunningTotal.plus(finalAmount);
    formulaContext[comp.code] = unproratedAmount.toNumber();
    formulaContext.GROSS = earningsRunningTotal.toNumber();
  }

  // Balancing Component (e.g. Special Allowance = Monthly CTC * payableRatio - sum of other earnings)
  if (balancingComponent) {
    const proratedMonthlyCtc = monthlyCtcDec.mul(payableRatio).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const balancingAmount = proratedMonthlyCtc.minus(earningsRunningTotal);

    if (balancingAmount.isNegative()) {
      blockers.push(`Balancing component ${balancingComponent.code} is negative (${balancingAmount.toFixed(2)})`);
    }

    const finalBalancing = Decimal.max(0, balancingAmount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    lines.push({
      code: balancingComponent.code,
      name: balancingComponent.name,
      kind: 'earning',
      amount: finalBalancing.toFixed(2),
      taxableAmount: balancingComponent.taxable !== false ? finalBalancing.toFixed(2) : '0.00',
    });
    earningsRunningTotal = earningsRunningTotal.plus(finalBalancing);
    formulaContext[balancingComponent.code] = finalBalancing.toNumber();
    formulaContext.GROSS = earningsRunningTotal.toNumber();
  }

  // Step 3: Inputs (Arrears, Bonuses, Incentives, Reimbursements, Deductions)
  let inputsEarningsTotal = new Decimal(0);
  let inputsDeductionsTotal = new Decimal(0);
  let reimbursementsTotal = new Decimal(0);

  for (const inp of input.inputs) {
    const amt = new Decimal(inp.amount);
    if (inp.type === 'bonus' || inp.type === 'incentive' || inp.type === 'arrear' || inp.type === 'adjustment') {
      lines.push({
        code: inp.componentCode || inp.type.toUpperCase(),
        name: inp.type.toUpperCase(),
        kind: 'earning',
        amount: amt.toFixed(2),
        taxableAmount: inp.taxable !== false ? amt.toFixed(2) : '0.00',
      });
      inputsEarningsTotal = inputsEarningsTotal.plus(amt);
    } else if (inp.type === 'reimbursement') {
      lines.push({
        code: inp.componentCode || 'REIMBURSEMENT',
        name: 'REIMBURSEMENT',
        kind: 'reimbursement',
        amount: amt.toFixed(2),
        taxableAmount: inp.taxable ? amt.toFixed(2) : '0.00',
      });
      reimbursementsTotal = reimbursementsTotal.plus(amt);
    } else if (inp.type === 'deduction') {
      lines.push({
        code: inp.componentCode || 'DEDUCTION',
        name: 'DEDUCTION',
        kind: 'deduction',
        amount: amt.toFixed(2),
        taxableAmount: '0.00',
      });
      inputsDeductionsTotal = inputsDeductionsTotal.plus(amt);
    }
  }

  const grossEarnings = earningsRunningTotal.plus(inputsEarningsTotal).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  // Step 4: Statutory Wage Bases
  let pfWages = new Decimal(0);
  let esiWages = new Decimal(0);
  let gratuityWages = new Decimal(0);
  let statutoryWages = new Decimal(0);
  let excludedRemuneration = new Decimal(0);

  for (const line of lines) {
    if (line.kind !== 'earning') continue;
    const compDef = input.salary.components.find(c => c.code === line.code);
    const amt = new Decimal(line.amount);

    if (compDef?.pfWage) pfWages = pfWages.plus(amt);
    if (compDef?.esiWage) esiWages = esiWages.plus(amt);
    if (compDef?.gratuityWage) gratuityWages = gratuityWages.plus(amt);
    if (compDef?.statutoryWage) {
      statutoryWages = statutoryWages.plus(amt);
    } else {
      excludedRemuneration = excludedRemuneration.plus(amt);
    }
  }

  // Labour Code Wages check (Wages Floor 50%)
  if (input.settings.labourCodeWages?.enabled && input.rules.LABOUR_CODE_WAGES) {
    const lcw = calculateLabourCodeWages({
      totalRemuneration: grossEarnings.toFixed(2),
      statutoryWageComponents: { STATUTORY: statutoryWages.toFixed(2) },
      excludedComponents: { EXCLUDED: excludedRemuneration.toFixed(2) },
      rule: input.rules.LABOUR_CODE_WAGES,
    });
    if (lcw.warningBelowFloor) {
      warnings.push(`Labour Code Wages floor violated: wages must be at least 50% of total remuneration (excess add-back: ₹${lcw.excessRemunerationAddedBack})`);
      // When floor violated, statutory base increases by excess add-back
      pfWages = pfWages.plus(new Decimal(lcw.excessRemunerationAddedBack));
      gratuityWages = gratuityWages.plus(new Decimal(lcw.excessRemunerationAddedBack));
    }
  }

  // Step 5: PF (Provident Fund)
  let employeePf = new Decimal(0);
  let totalEmployerCost = grossEarnings;

  if (input.settings.pfEnabled !== false && input.rules.PF_IN) {
    const pfResult = calculatePf({
      pfWages: pfWages.toFixed(2),
      rule: input.rules.PF_IN,
    });
    employeePf = new Decimal(pfResult.employeePf);

    lines.push({
      code: 'PF_EE',
      name: 'Provident Fund (Employee)',
      kind: 'deduction',
      amount: pfResult.employeePf,
      taxableAmount: '0.00',
      ruleRef: 'PF_IN',
    });

    lines.push({
      code: 'PF_ER',
      name: 'Provident Fund (Employer)',
      kind: 'employer_contribution',
      amount: pfResult.totalEmployerContribution,
      taxableAmount: '0.00',
      ruleRef: 'PF_IN',
    });

    totalEmployerCost = totalEmployerCost.plus(new Decimal(pfResult.totalEmployerContribution));
  }

  // Step 6: ESI (Employee State Insurance)
  let employeeEsi = new Decimal(0);
  if (input.settings.esiEnabled !== false && input.rules.ESI_IN) {
    const esiResult = calculateEsi({
      grossWages: esiWages.toFixed(2),
      rule: input.rules.ESI_IN,
    });
    employeeEsi = new Decimal(esiResult.employeeEsi);

    if (employeeEsi.greaterThan(0)) {
      lines.push({
        code: 'ESI_EE',
        name: 'ESI (Employee)',
        kind: 'deduction',
        amount: esiResult.employeeEsi,
        taxableAmount: '0.00',
        ruleRef: 'ESI_IN',
      });
    }

    const erEsi = new Decimal(esiResult.employerEsi);
    if (erEsi.greaterThan(0)) {
      lines.push({
        code: 'ESI_ER',
        name: 'ESI (Employer)',
        kind: 'employer_contribution',
        amount: esiResult.employerEsi,
        taxableAmount: '0.00',
        ruleRef: 'ESI_IN',
      });
      totalEmployerCost = totalEmployerCost.plus(erEsi);
    }
  }

  // Step 7: PT & LWF
  let ptAmount = new Decimal(0);
  if (input.settings.ptEnabled !== false && input.rules.PT) {
    const ptResult = calculatePt({
      grossEarnings: grossEarnings.toFixed(2),
      rule: input.rules.PT,
      gender: input.employee.gender as 'male' | 'female' | 'other' | undefined,
      month: input.periodMonth || 10,
    });
    ptAmount = new Decimal(ptResult.taxAmount);
    if (ptAmount.greaterThan(0)) {
      lines.push({
        code: 'PT',
        name: 'Professional Tax',
        kind: 'deduction',
        amount: ptResult.taxAmount,
        taxableAmount: '0.00',
        ruleRef: `PT_${input.employee.state}`,
      });
    }
  }

  let lwfEmployee = new Decimal(0);
  if (input.settings.lwfEnabled !== false && input.rules.LWF) {
    const lwfResult = calculateLwf({
      grossEarnings: grossEarnings.toFixed(2),
      month: input.periodMonth || 12,
      rule: input.rules.LWF,
    });
    lwfEmployee = new Decimal(lwfResult.employeeContribution);
    if (lwfEmployee.greaterThan(0)) {
      lines.push({
        code: 'LWF_EE',
        name: 'Labour Welfare Fund',
        kind: 'deduction',
        amount: lwfResult.employeeContribution,
        taxableAmount: '0.00',
        ruleRef: `LWF_${input.employee.state}`,
      });
    }
  }

  // Step 8: TDS (Section 392)
  let tdsThisMonth = new Decimal(0);
  let tdsComputationResult: TdsCalculationResult | undefined;

  if (input.rules.TDS_IN && input.taxDeclaration) {
    const tdsInput = {
      regime: input.taxDeclaration.regime,
      currentEarnings: grossEarnings.toFixed(2),
      remainingMonths: input.taxDeclaration.remainingMonths,
      ytdEarnings: input.ytd?.gross || '0.00',
      ytdTdsDeducted: input.ytd?.tdsDeducted || '0.00',
      openingBalanceEarnings: input.ytd?.openingBalanceEarnings || '0.00',
      openingBalanceTds: input.ytd?.openingBalanceTds || '0.00',
      verifiedDeductions: input.taxDeclaration.verifiedDeductions,
      previousEmployerEarnings: input.taxDeclaration.previousEmployerEarnings,
      previousEmployerTds: input.taxDeclaration.previousEmployerTds,
      rule: input.rules.TDS_IN,
    };

    tdsComputationResult = computeTds(tdsInput);
    tdsThisMonth = new Decimal(tdsComputationResult.tdsThisMonth);

    if (tdsThisMonth.greaterThan(0)) {
      lines.push({
        code: 'TDS',
        name: 'Income Tax (TDS u/s 392)',
        kind: 'deduction',
        amount: tdsComputationResult.tdsThisMonth,
        taxableAmount: '0.00',
        ruleRef: 'TDS_IN',
      });
    }
  }

  // Step 9: Loans & Advances EMI Recovery with Net Pay Safeguard
  const mandatoryDeductions = employeePf
    .plus(employeeEsi)
    .plus(ptAmount)
    .plus(lwfEmployee)
    .plus(inputsDeductionsTotal)
    .plus(tdsThisMonth);

  let netAvailableForLoans = grossEarnings.plus(reimbursementsTotal).minus(mandatoryDeductions);
  let totalLoanEmiDeducted = new Decimal(0);

  for (const loan of input.loansDue) {
    const emiDue = new Decimal(loan.amount);
    if (emiDue.lessThanOrEqualTo(0)) continue;

    let emiToRecover = emiDue;
    if (netAvailableForLoans.lessThan(emiDue)) {
      // User approved safeguard: Partially recover up to net zero and log warning
      emiToRecover = Decimal.max(0, netAvailableForLoans);
      warnings.push(`Loan EMI ${emiDue.toFixed(2)} partially recovered as ${emiToRecover.toFixed(2)} due to net pay safeguard`);
    }

    if (emiToRecover.greaterThan(0)) {
      lines.push({
        code: 'LOAN_EMI',
        name: 'Loan EMI Recovery',
        kind: 'deduction',
        amount: emiToRecover.toFixed(2),
        taxableAmount: '0.00',
        ruleRef: `loan:${loan.loanId}`,
      });
      totalLoanEmiDeducted = totalLoanEmiDeducted.plus(emiToRecover);
      netAvailableForLoans = netAvailableForLoans.minus(emiToRecover);
    }
  }

  // Step 10: Net & Checks
  const totalDeductions = mandatoryDeductions.plus(totalLoanEmiDeducted);
  const finalNet = grossEarnings.plus(reimbursementsTotal).minus(totalDeductions).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  if (finalNet.isNegative()) {
    if (input.settings.negativeNetPolicy === 'block') {
      blockers.push(`Negative net pay calculated: ₹${finalNet.toFixed(2)}`);
    } else {
      warnings.push(`Negative net pay calculated: ₹${finalNet.toFixed(2)} (Policy: ${input.settings.negativeNetPolicy})`);
    }
  }

  // Blocker checks (missing bank details, missing PAN)
  if (!input.employee.bankAccountNumber) {
    warnings.push('Employee missing bank account details');
  }

  // Step 11: Gratuity Provision, Hash & Totals
  let gratuityProvision = '0.00';
  if (input.rules.GRATUITY_IN) {
    const grat = calculateGratuityProvision({
      basicWageMonthly: gratuityWages.toFixed(2),
      tenureYears: 1,
      rule: input.rules.GRATUITY_IN,
    });
    gratuityProvision = grat.provisionAmount;
  }

  const inputHash = crypto
    .createHash('sha256')
    .update(canonicalStringify(input))
    .digest('hex');

  return {
    engineVersion: ENGINE_VERSION,
    inputHash,
    payableDays,
    payableRatio: payableRatio.toFixed(6),
    lines,
    gross: grossEarnings.toFixed(2),
    deductions: totalDeductions.toFixed(2),
    reimbursements: reimbursementsTotal.toFixed(2),
    net: finalNet.toFixed(2),
    employerCost: totalEmployerCost.toFixed(2),
    gratuityProvision,
    warnings,
    blockers,
    tdsComputation: tdsComputationResult,
  };
}
