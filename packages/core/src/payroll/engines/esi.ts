import { Decimal } from 'decimal.js';
import type { z } from 'zod';
import type { esiRulePayloadSchema } from '../rules/schemas.js';

export interface EsiCalculationInput {
  grossWages: number | string;
  hasExistingCoverage?: boolean;
  rule: z.infer<typeof esiRulePayloadSchema>;
}

export interface EsiCalculationResult {
  eligible: boolean;
  employeeEsi: string;
  employerEsi: string;
  totalEsi: string;
}

/**
 * Pure ESI (Employee State Insurance) calculation engine.
 * No DB, no clock. Driven entirely by the rule payload.
 */
export function calculateEsi(input: EsiCalculationInput): EsiCalculationResult {
  const { rule } = input;
  const wages = new Decimal(input.grossWages);
  const threshold = new Decimal(rule.wageThresholdMonthly);

  // Eligibility check:
  // Eligible if gross wages <= threshold OR if continuity stickiness applies to existing coverage
  const eligible =
    wages.lte(threshold) || (Boolean(rule.continuityStickiness) && Boolean(input.hasExistingCoverage));

  if (!eligible || wages.isZero()) {
    return {
      eligible: false,
      employeeEsi: '0.00',
      employerEsi: '0.00',
      totalEsi: '0.00',
    };
  }

  const roundMode = rule.roundingMode === 'ceil' ? Decimal.ROUND_CEIL : Decimal.ROUND_HALF_UP;

  const employeeEsi = wages
    .mul(rule.employeeRatePct)
    .div(100)
    .toDecimalPlaces(0, roundMode);

  const employerEsi = wages
    .mul(rule.employerRatePct)
    .div(100)
    .toDecimalPlaces(0, roundMode);

  const totalEsi = employeeEsi.add(employerEsi);

  return {
    eligible: true,
    employeeEsi: employeeEsi.toFixed(2),
    employerEsi: employerEsi.toFixed(2),
    totalEsi: totalEsi.toFixed(2),
  };
}
