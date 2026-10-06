import { Decimal } from 'decimal.js';
import type { z } from 'zod';
import type { lwfRulePayloadSchema } from '../rules/schemas.js';

export interface LwfCalculationInput {
  grossEarnings: number | string;
  month: number; // 1 to 12
  rule: z.infer<typeof lwfRulePayloadSchema>;
}

export interface LwfCalculationResult {
  isDeductionMonth: boolean;
  employeeContribution: string;
  employerContribution: string;
  totalContribution: string;
}

/**
 * Pure Labour Welfare Fund (LWF) calculation engine.
 * No DB, no clock. Driven entirely by the state rule payload.
 */
export function calculateLwf(input: LwfCalculationInput): LwfCalculationResult {
  const { rule, month } = input;
  const gross = new Decimal(input.grossEarnings);

  // Check if month is one of the designated deduction months for this state
  if (!rule.deductionMonths.includes(month)) {
    return {
      isDeductionMonth: false,
      employeeContribution: '0.00',
      employerContribution: '0.00',
      totalContribution: '0.00',
    };
  }

  // Check wage eligibility ceiling if configured
  if (rule.wageEligibilityCeiling !== null && gross.gt(rule.wageEligibilityCeiling)) {
    return {
      isDeductionMonth: false,
      employeeContribution: '0.00',
      employerContribution: '0.00',
      totalContribution: '0.00',
    };
  }

  const employeeContrib = new Decimal(rule.employeeContribution);
  const employerContrib = new Decimal(rule.employerContribution);
  const total = employeeContrib.add(employerContrib);

  return {
    isDeductionMonth: true,
    employeeContribution: employeeContrib.toFixed(2),
    employerContribution: employerContrib.toFixed(2),
    totalContribution: total.toFixed(2),
  };
}
