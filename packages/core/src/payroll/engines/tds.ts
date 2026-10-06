import { Decimal } from 'decimal.js';
import type { z } from 'zod';
import type { tdsRulePayloadSchema } from '../rules/schemas.js';

export interface TdsCalculationInput {
  regime: 'new' | 'old';
  ytdEarnings: number | string;
  openingBalanceEarnings?: number | string | undefined;
  currentEarnings: number | string;
  projectedMonthlyEarnings?: number | string | undefined;
  remainingMonths: number;
  previousEmployerEarnings?: number | string | undefined;
  previousEmployerTds?: number | string | undefined;
  ytdTdsDeducted: number | string;
  openingBalanceTds?: number | string | undefined;
  verifiedDeductions?: Record<string, number | string> | undefined;
  rule: z.infer<typeof tdsRulePayloadSchema>;
}

export interface TdsSlabBreakdown {
  minIncome: number;
  maxIncome: number | null;
  ratePct: number;
  taxableAmount: string;
  taxAmount: string;
}

export interface TdsCalculationResult {
  regime: 'new' | 'old';
  projectedAnnualGross: string;
  standardDeduction: string;
  totalDeductions: string;
  netTaxableIncome: string;
  slabTax: string;
  rebate87A: string;
  taxAfterRebate: string;
  surcharge: string;
  cess: string;
  totalAnnualTax: string;
  ytdTdsPaid: string;
  remainingTax: string;
  remainingMonths: number;
  tdsThisMonth: string;
  slabsBreakdown: TdsSlabBreakdown[];
}

/**
 * Pure function to calculate Section 392 Salary TDS.
 * Zero database access, zero clock, zero side effects.
 * Driven strictly by the TDS_IN rule data.
 */
export function computeTds(input: TdsCalculationInput): TdsCalculationResult {
  const { regime, rule } = input;
  const regimeConfig = rule.regimes[regime];
  if (!regimeConfig) {
    throw new Error(`Regime '${regime}' not found in TDS rule configuration for FY ${rule.financialYear}`);
  }

  // 1. Annual Gross Income Projection
  const ytdGross = new Decimal(input.ytdEarnings || 0);
  const openingGross = new Decimal(input.openingBalanceEarnings || 0);
  const currentGross = new Decimal(input.currentEarnings || 0);
  const prevEmpGross = new Decimal(input.previousEmployerEarnings || 0);
  const projectedMonthly = new Decimal(input.projectedMonthlyEarnings ?? input.currentEarnings ?? 0);
  const remainingMonths = Math.max(0, input.remainingMonths);

  const futureGross = projectedMonthly.mul(remainingMonths);
  const projectedAnnualGross = ytdGross
    .plus(openingGross)
    .plus(currentGross)
    .plus(futureGross)
    .plus(prevEmpGross)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  // 2. Standard Deduction
  const standardDeduction = new Decimal(regimeConfig.standardDeduction);

  // 3. Chapter VI-A & Other Deductions
  let totalDeductions = new Decimal(0);
  if (input.verifiedDeductions) {
    for (const [code, amount] of Object.entries(input.verifiedDeductions)) {
      if (regimeConfig.allowedDeductions.includes(code)) {
        totalDeductions = totalDeductions.plus(new Decimal(amount || 0));
      }
    }
  }

  // 4. Net Taxable Income
  const totalExemptions = standardDeduction.plus(totalDeductions);
  const rawTaxable = projectedAnnualGross.minus(totalExemptions);
  const netTaxableIncome = Decimal.max(0, rawTaxable).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  // 5. Slab Tax Calculation
  let slabTax = new Decimal(0);
  const slabsBreakdown: TdsSlabBreakdown[] = [];

  for (const slab of regimeConfig.taxSlabs) {
    const minInc = new Decimal(slab.minIncome);
    const maxInc = slab.maxIncome !== null ? new Decimal(slab.maxIncome) : null;
    const rate = new Decimal(slab.ratePct).div(100);

    let taxableInSlab = new Decimal(0);
    if (netTaxableIncome.greaterThan(minInc)) {
      const upper = maxInc !== null ? Decimal.min(netTaxableIncome, maxInc) : netTaxableIncome;
      taxableInSlab = upper.minus(minInc);
    }

    const taxInSlab = taxableInSlab.mul(rate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    slabTax = slabTax.plus(taxInSlab);

    slabsBreakdown.push({
      minIncome: slab.minIncome,
      maxIncome: slab.maxIncome,
      ratePct: slab.ratePct,
      taxableAmount: taxableInSlab.toFixed(2),
      taxAmount: taxInSlab.toFixed(2),
    });
  }

  // 6. Section 87A Rebate & Marginal Relief
  const rebateConfig = regimeConfig.rebate;
  let rebate87A = new Decimal(0);

  if (netTaxableIncome.lessThanOrEqualTo(rebateConfig.thresholdTaxableIncome)) {
    rebate87A = Decimal.min(slabTax, new Decimal(rebateConfig.maxRebateAmount));
  } else if (rebateConfig.marginalReliefEnabled) {
    // Marginal relief under Section 87A (income slightly above rebate threshold)
    const excessIncome = netTaxableIncome.minus(rebateConfig.thresholdTaxableIncome);
    if (slabTax.greaterThan(excessIncome)) {
      rebate87A = slabTax.minus(excessIncome);
    }
  }

  const taxAfterRebate = Decimal.max(0, slabTax.minus(rebate87A));

  // 7. Surcharge & Marginal Relief
  let surcharge = new Decimal(0);
  for (const sSlab of regimeConfig.surchargeSlabs) {
    const minInc = new Decimal(sSlab.minIncome);
    const maxInc = sSlab.maxIncome !== null ? new Decimal(sSlab.maxIncome) : null;

    if (netTaxableIncome.greaterThan(minInc) && (maxInc === null || netTaxableIncome.lessThanOrEqualTo(maxInc))) {
      const surchargeRate = new Decimal(sSlab.ratePct).div(100);
      surcharge = taxAfterRebate.mul(surchargeRate);

      if (sSlab.marginalReliefEnabled) {
        // Marginal relief for surcharge: Tax + Surcharge cannot exceed tax on threshold + excess income
        const excessIncome = netTaxableIncome.minus(minInc);
        const maxAllowedTaxPlusSurcharge = taxAfterRebate.plus(excessIncome);
        if (taxAfterRebate.plus(surcharge).greaterThan(maxAllowedTaxPlusSurcharge)) {
          surcharge = Decimal.max(0, maxAllowedTaxPlusSurcharge.minus(taxAfterRebate));
        }
      }
      break;
    }
  }

  // 8. Health and Education Cess
  const cessRate = new Decimal(regimeConfig.healthAndEducationCessPct).div(100);
  const cess = taxAfterRebate.plus(surcharge).mul(cessRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  // 9. Total Annual Tax Liability
  const totalAnnualTax = taxAfterRebate.plus(surcharge).plus(cess).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  // 10. Monthly TDS Spread
  const ytdTds = new Decimal(input.ytdTdsDeducted || 0);
  const openTds = new Decimal(input.openingBalanceTds || 0);
  const prevEmpTds = new Decimal(input.previousEmployerTds || 0);
  const ytdTdsPaid = ytdTds.plus(openTds).plus(prevEmpTds).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  const remainingTax = Decimal.max(0, totalAnnualTax.minus(ytdTdsPaid));
  const divisor = remainingMonths + 1; // Current month is 1 of the remaining months
  const tdsThisMonth = remainingTax.div(divisor).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  return {
    regime,
    projectedAnnualGross: projectedAnnualGross.toFixed(2),
    standardDeduction: standardDeduction.toFixed(2),
    totalDeductions: totalDeductions.toFixed(2),
    netTaxableIncome: netTaxableIncome.toFixed(2),
    slabTax: slabTax.toFixed(2),
    rebate87A: rebate87A.toFixed(2),
    taxAfterRebate: taxAfterRebate.toFixed(2),
    surcharge: surcharge.toFixed(2),
    cess: cess.toFixed(2),
    totalAnnualTax: totalAnnualTax.toFixed(2),
    ytdTdsPaid: ytdTdsPaid.toFixed(2),
    remainingTax: remainingTax.toFixed(2),
    remainingMonths,
    tdsThisMonth: tdsThisMonth.toFixed(2),
    slabsBreakdown,
  };
}
