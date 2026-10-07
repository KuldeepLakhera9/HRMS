import { Decimal } from 'decimal.js';
import type { PayslipCalculationResult, PayslipCalculationInput } from '../engines/payslip.js';

export interface EvaluationFlags {
  blockers: string[];
  warnings: string[];
}

export interface VarianceBaseline {
  previousNet?: string | undefined;
  previousGross?: string | undefined;
  hasPreviousPayslip: boolean;
}

export class WarningsBlockersEngine {
  /**
   * Evaluates warnings and blockers for a calculated payslip.
   */
  evaluate(
    input: PayslipCalculationInput,
    result: PayslipCalculationResult,
    baseline?: VarianceBaseline,
    options: { allowNegativeNet?: boolean } = {},
  ): EvaluationFlags {
    const blockers: string[] = [];
    const warnings: string[] = [];

    // 1. Blocker: Missing Bank Account (needed for disbursement)
    const emp = input.employee;
    if (!emp.bankAccountNumber && !emp.pan) {
      warnings.push('MISSING_BANK_DETAILS: Employee has no bank account on file');
    }

    // 2. Blocker: Negative Net Pay Policy
    const net = new Decimal(result.net);
    if (net.isNegative() && !options.allowNegativeNet) {
      blockers.push(`NEGATIVE_NET_PAY: Net pay is negative (${result.net})`);
    }

    // 4. Warning: Zero Paid Days
    if (input.attendance.paidDays === 0) {
      warnings.push('ZERO_PAID_DAYS: Payable days for period is 0');
    }

    // 5. Warning: First Payroll
    if (!baseline || !baseline.hasPreviousPayslip) {
      warnings.push('FIRST_PAYROLL: Initial payroll run for this employee');
    }

    // 6. Warning: Large Variance vs Previous Run (> 20% or > 10,000 INR)
    if (baseline?.previousNet) {
      const prevNet = new Decimal(baseline.previousNet);
      if (prevNet.isPositive()) {
        const diff = net.minus(prevNet).abs();
        const pctDiff = diff.dividedBy(prevNet);
        if (pctDiff.greaterThan(0.20) || diff.greaterThan(10000)) {
          warnings.push(
            `LARGE_VARIANCE: Net pay (${result.net}) differs by ${diff.toFixed(2)} (${pctDiff.times(100).toFixed(1)}%) from previous run (${baseline.previousNet})`,
          );
        }
      }
    }

    // 7. Warning: Labour Code Wages Floor
    const gross = new Decimal(result.gross);
    if (gross.isPositive()) {
      const basicLine = result.lines.find(l => l.code === 'BASIC');
      if (basicLine) {
        const basicAmt = new Decimal(basicLine.amount);
        if (basicAmt.dividedBy(gross).lessThan(0.50)) {
          warnings.push(
            `BELOW_LABOUR_CODE_FLOOR: Basic earning (${basicLine.amount}) is less than 50% of gross remuneration (${result.gross})`,
          );
        }
      }
    }

    return { blockers, warnings };
  }

  /**
   * Helper to evaluate blockers based on high-level pre-conditions and policy settings.
   */
  evaluateBlockers(criteria: {
    hasBankDetails?: boolean;
    salaryStatus?: string;
    ruleSetsExpired?: boolean;
    negativeNet?: boolean;
    negativeNetPolicy?: 'block' | 'hold' | 'carry_forward';
    balancingNegative?: boolean;
  }): string[] {
    const blockers: string[] = [];
    if (criteria.salaryStatus && criteria.salaryStatus !== 'approved') {
      blockers.push(`Employee salary assignment is ${criteria.salaryStatus}, must be approved`);
    }
    if (criteria.ruleSetsExpired) {
      blockers.push('Statutory rule set has expired or is not active for the period');
    }
    if (criteria.negativeNet && criteria.negativeNetPolicy === 'block') {
      blockers.push('Negative net pay calculated and company policy is set to block');
    }
    if (criteria.balancingNegative) {
      blockers.push('Balancing component calculation yielded negative amount');
    }
    return blockers;
  }
}

