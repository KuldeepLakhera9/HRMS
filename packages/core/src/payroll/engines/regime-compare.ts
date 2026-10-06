import { Decimal } from 'decimal.js';
import type { z } from 'zod';
import type { tdsRulePayloadSchema } from '../rules/schemas.js';
import { computeTds, TdsCalculationResult } from './tds.js';

export interface RegimeCompareInput {
  annualEarnings: number | string;
  verifiedDeductions?: Record<string, number | string> | undefined;
  rule: z.infer<typeof tdsRulePayloadSchema>;
}

export interface RegimeComparisonResult {
  recommendedRegime: 'new' | 'old';
  annualTaxSavings: string;
  monthlyTaxSavings: string;
  newRegime: TdsCalculationResult;
  oldRegime: TdsCalculationResult;
}

/**
 * Pure helper function to compare New Regime vs Old Regime for an employee.
 * Uses computeTds under both regimes and recommends the lowest tax option.
 */
export function compareRegimes(input: RegimeCompareInput): RegimeComparisonResult {
  const newRegimeCalc = computeTds({
    regime: 'new',
    currentEarnings: new Decimal(input.annualEarnings).div(12).toFixed(2),
    remainingMonths: 11,
    ytdEarnings: 0,
    ytdTdsDeducted: 0,
    verifiedDeductions: input.verifiedDeductions,
    rule: input.rule,
  });

  const oldRegimeCalc = computeTds({
    regime: 'old',
    currentEarnings: new Decimal(input.annualEarnings).div(12).toFixed(2),
    remainingMonths: 11,
    ytdEarnings: 0,
    ytdTdsDeducted: 0,
    verifiedDeductions: input.verifiedDeductions,
    rule: input.rule,
  });

  const newTax = new Decimal(newRegimeCalc.totalAnnualTax);
  const oldTax = new Decimal(oldRegimeCalc.totalAnnualTax);

  let recommendedRegime: 'new' | 'old' = 'new';
  let savings = new Decimal(0);

  if (oldTax.lessThan(newTax)) {
    recommendedRegime = 'old';
    savings = newTax.minus(oldTax);
  } else {
    recommendedRegime = 'new';
    savings = oldTax.minus(newTax);
  }

  const monthlySavings = savings.div(12).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  return {
    recommendedRegime,
    annualTaxSavings: savings.toFixed(2),
    monthlyTaxSavings: monthlySavings.toFixed(2),
    newRegime: newRegimeCalc,
    oldRegime: oldRegimeCalc,
  };
}
