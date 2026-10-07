import { Decimal } from 'decimal.js';
import type { z } from 'zod';
import type { pfRulePayloadSchema } from '../rules/schemas.js';

export interface PfCalculationInput {
  pfWages: number | string;
  vpfAmount?: number | string;
  contributeOnActual?: boolean;
  rule: z.infer<typeof pfRulePayloadSchema>;
}

export interface PfCalculationResult {
  wageBase: string;
  employeePf: string;
  vpf: string;
  totalEmployeeDeduction: string;
  employerEps: string;
  employerEpf: string;
  edli: string;
  adminCharges: string;
  totalEmployerContribution: string;
}

/**
 * Pure PF (Provident Fund) calculation engine.
 * No DB, no clock. Driven entirely by the rule payload.
 */
export function calculatePf(input: PfCalculationInput): PfCalculationResult {
  const { rule } = input;
  const ruleFallback = rule as unknown as Record<string, number | undefined>;
  const wages = new Decimal(input.pfWages);
  const vpf = new Decimal(input.vpfAmount ?? 0);
  const rawCeiling = rule.wageCeilingMonthly ?? ruleFallback.statutoryWageCeiling;
  if (rawCeiling == null) {
    throw new Error('Statutory PF rule must define wageCeilingMonthly');
  }
  const ceiling = new Decimal(rawCeiling);

  // Determine wage base
  let wageBase = wages;
  if (!input.contributeOnActual || !rule.allowContributeOnActual) {
    if (ceiling.gt(0) && wageBase.gt(ceiling)) {
      wageBase = ceiling;
    }
  }

  // EPS wage ceiling is strictly capped at statutory ceiling
  let epsWageBase = wageBase;
  if (ceiling.gt(0) && epsWageBase.gt(ceiling)) {
    epsWageBase = ceiling;
  }

  const roundMode =
    rule.roundingMode === 'floor'
      ? Decimal.ROUND_FLOOR
      : rule.roundingMode === 'ceil'
        ? Decimal.ROUND_CEIL
        : Decimal.ROUND_HALF_UP;

  // Employee PF
  const employeePf = wageBase
    .mul(rule.employeeRatePct)
    .div(100)
    .toDecimalPlaces(0, roundMode);

  // VPF
  const finalVpf = rule.allowVpf ? vpf.toDecimalPlaces(0, roundMode) : new Decimal(0);
  const totalEmployeeDeduction = employeePf.add(finalVpf);

  // Employer EPS (8.33% capped)
  const employerEps = epsWageBase
    .mul(rule.employerEpsRatePct)
    .div(100)
    .toDecimalPlaces(0, roundMode);

  // Employer EPF (3.67% or wageBase * employerEpfRatePct / 100)
  const employerEpf = wageBase
    .mul(rule.employerEpfRatePct)
    .div(100)
    .toDecimalPlaces(0, roundMode);

  // EDLI (0.5% capped at statutory ceiling)
  const edli = epsWageBase
    .mul(rule.edliRatePct)
    .div(100)
    .toDecimalPlaces(0, roundMode);

  // Admin Charges (on actual or wage base per rule)
  const adminRate = rule.adminChargeRatePct ?? ruleFallback.adminChargesRatePct;
  if (adminRate == null) {
    throw new Error('Statutory PF rule must define adminChargeRatePct');
  }
  const adminCharges = wageBase
    .mul(adminRate)
    .div(100)
    .toDecimalPlaces(0, roundMode);

  const totalEmployerContribution = employerEps.add(employerEpf).add(edli).add(adminCharges);

  return {
    wageBase: wageBase.toFixed(2),
    employeePf: employeePf.toFixed(2),
    vpf: finalVpf.toFixed(2),
    totalEmployeeDeduction: totalEmployeeDeduction.toFixed(2),
    employerEps: employerEps.toFixed(2),
    employerEpf: employerEpf.toFixed(2),
    edli: edli.toFixed(2),
    adminCharges: adminCharges.toFixed(2),
    totalEmployerContribution: totalEmployerContribution.toFixed(2),
  };
}
