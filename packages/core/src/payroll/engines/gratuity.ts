import { Decimal } from 'decimal.js';
import type { z } from 'zod';
import type { gratuityRulePayloadSchema } from '../rules/schemas.js';

export interface GratuityCalculationInput {
  basicWageMonthly: number | string;
  tenureYears: number; // e.g. 5.5
  employmentType?: 'permanent' | 'fixed_term';
  rule: z.infer<typeof gratuityRulePayloadSchema>;
}

export interface GratuityCalculationResult {
  eligible: boolean;
  provisionAmount: string;
  isCapped: boolean;
}

/**
 * Pure Gratuity Provision calculation engine.
 * No DB, no clock. Driven entirely by the rule payload.
 * Formula: (basicWage * formulaBasisDays * tenureYears) / divisorDays (typically (15 * basic * tenure) / 26)
 */
export function calculateGratuityProvision(input: GratuityCalculationInput): GratuityCalculationResult {
  const { rule, tenureYears, employmentType = 'permanent' } = input;
  const basic = new Decimal(input.basicWageMonthly);
  const tenure = new Decimal(tenureYears);

  const ruleFallback = rule as unknown as Record<string, number | undefined>;
  const formulaBasisDays = rule.formulaBasisDays;
  if (formulaBasisDays == null) {
    throw new Error('Statutory Gratuity rule must define formulaBasisDays');
  }
  const divisorDays = rule.divisorDays;
  if (divisorDays == null) {
    throw new Error('Statutory Gratuity rule must define divisorDays');
  }
  const minYears =
    employmentType === 'fixed_term'
      ? (rule.eligibilityYearsFixedTerm ?? ruleFallback.fixedTermEligibilityYears)
      : (rule.eligibilityYearsPermanent ?? ruleFallback.permanentEligibilityYears);
  if (minYears == null) {
    throw new Error('Statutory Gratuity rule must define eligibility years');
  }

  const eligible = tenure.gte(minYears);

  if (tenure.lte(0) || basic.lte(0)) {
    return {
      eligible: false,
      provisionAmount: '0.00',
      isCapped: false,
    };
  }

  // Formula: (basic * formulaBasisDays * tenure) / divisorDays
  const rawProvision = basic
    .mul(formulaBasisDays)
    .mul(tenure)
    .div(divisorDays);

  const rawCeiling = rule.maxCeilingAmount ?? ruleFallback.ceilingAmount;
  if (rawCeiling == null) {
    throw new Error('Statutory Gratuity rule must define maxCeilingAmount');
  }
  const ceiling = new Decimal(rawCeiling);
  let finalProvision = rawProvision;
  let isCapped = false;

  if (ceiling.gt(0) && finalProvision.gt(ceiling)) {
    finalProvision = ceiling;
    isCapped = true;
  }

  return {
    eligible,
    provisionAmount: finalProvision.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2),
    isCapped,
  };
}
