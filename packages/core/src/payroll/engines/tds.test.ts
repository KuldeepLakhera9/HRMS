import { describe, it, expect } from 'vitest';
import { computeTds, TdsCalculationInput } from './tds.js';
import { compareRegimes } from './regime-compare.js';
import type { z } from 'zod';
import type { tdsRulePayloadSchema } from '../rules/schemas.js';

type TdsRule = z.infer<typeof tdsRulePayloadSchema>;

const sampleTdsRule: TdsRule = {
  financialYear: '2026-2027',
  regimes: {
    new: {
      standardDeduction: 75000,
      taxSlabs: [
        { minIncome: 0, maxIncome: 300000, ratePct: 0 },
        { minIncome: 300000, maxIncome: 700000, ratePct: 5 },
        { minIncome: 700000, maxIncome: 1000000, ratePct: 10 },
        { minIncome: 1000000, maxIncome: 1200000, ratePct: 15 },
        { minIncome: 1200000, maxIncome: 1500000, ratePct: 20 },
        { minIncome: 1500000, maxIncome: null, ratePct: 30 },
      ],
      rebate: {
        thresholdTaxableIncome: 700000,
        maxRebateAmount: 20000, // 4,00,000 * 5% = 20,000
        marginalReliefEnabled: true,
      },
      surchargeSlabs: [
        { minIncome: 5000000, maxIncome: 10000000, ratePct: 10, marginalReliefEnabled: true },
        { minIncome: 10000000, maxIncome: null, ratePct: 15, marginalReliefEnabled: true },
      ],
      healthAndEducationCessPct: 4,
      allowedDeductions: ['80CCD_2'], // NPS employer contribution only
    },
    old: {
      standardDeduction: 50000,
      taxSlabs: [
        { minIncome: 0, maxIncome: 250000, ratePct: 0 },
        { minIncome: 250000, maxIncome: 500000, ratePct: 5 },
        { minIncome: 500000, maxIncome: 1000000, ratePct: 20 },
        { minIncome: 1000000, maxIncome: null, ratePct: 30 },
      ],
      rebate: {
        thresholdTaxableIncome: 500000,
        maxRebateAmount: 12500,
        marginalReliefEnabled: false,
      },
      surchargeSlabs: [
        { minIncome: 5000000, maxIncome: 10000000, ratePct: 10, marginalReliefEnabled: true },
      ],
      healthAndEducationCessPct: 4,
      allowedDeductions: ['80C', '80D', '24b', '80CCD_1B', '80CCD_2'],
    },
  },
};

describe('Section 392 Salary TDS Pure Engine (P4-RULES-02)', () => {
  it('calculates zero tax for income within Section 87A rebate limit in New Regime', () => {
    // 7.5 LPA CTC - 75,000 standard deduction = 6,75,000 taxable <= 7,00,000
    // Slabs: 0-3L @ 0% = 0, 3-6.75L (3.75L) @ 5% = 18,750
    // Full rebate of 18,750 applied => Net Tax = 0
    const result = computeTds({
      regime: 'new',
      currentEarnings: '62500.00', // 7.5L / 12
      remainingMonths: 11,
      ytdEarnings: 0,
      ytdTdsDeducted: 0,
      rule: sampleTdsRule,
    });

    expect(result.projectedAnnualGross).toBe('750000.00');
    expect(result.standardDeduction).toBe('75000.00');
    expect(result.netTaxableIncome).toBe('675000.00');
    expect(result.slabTax).toBe('18750.00');
    expect(result.rebate87A).toBe('18750.00');
    expect(result.taxAfterRebate).toBe('0.00');
    expect(result.totalAnnualTax).toBe('0.00');
    expect(result.tdsThisMonth).toBe('0.00');
  });

  it('calculates Section 87A marginal relief correctly when slightly above 7 Lakhs', () => {
    // Taxable income 7,10,000 (excess = 10,000)
    // Slabs: 0-3L @ 0 = 0; 3-7L @ 5% = 20,000; 7-7.1L (10,000) @ 10% = 1,000
    // Slab tax = 21,000
    // Under marginal relief, tax cannot exceed excess income (10,000)
    // Rebate = 21,000 - 10,000 = 11,000
    // Tax after rebate = 10,000
    // Cess @ 4% = 400
    // Total annual tax = 10,400
    const input: TdsCalculationInput = {
      regime: 'new',
      currentEarnings: 785000 / 12, // 785,000 - 75,000 std ded = 710,000 taxable
      remainingMonths: 11,
      ytdEarnings: 0,
      ytdTdsDeducted: 0,
      rule: sampleTdsRule,
    };

    const result = computeTds(input);
    expect(result.netTaxableIncome).toBe('710000.00');
    expect(result.slabTax).toBe('21000.00');
    expect(result.rebate87A).toBe('11000.00');
    expect(result.taxAfterRebate).toBe('10000.00');
    expect(result.cess).toBe('400.00');
    expect(result.totalAnnualTax).toBe('10400.00');
    // Monthly spread across 12 months = 10400 / 12 = 866.67
    expect(result.tdsThisMonth).toBe('866.67');
  });

  it('spreads remaining tax liability across remaining months', () => {
    // 12 LPA Annual Gross - 75,000 std ded = 11,25,000 taxable
    // Slabs:
    // 0-3L @ 0 = 0
    // 3-7L (4L) @ 5% = 20,000
    // 7-10L (3L) @ 10% = 30,000
    // 10-11.25L (1.25L) @ 15% = 18,750
    // Slab tax = 68,750. No rebate. Cess 4% = 2,750. Total tax = 71,500.
    // If in month 7 (remainingMonths = 5), and YTD TDS already deducted is 35,750:
    // Remaining tax = 71,500 - 35,750 = 35,750
    // Divisor = 5 + 1 = 6 months
    // Monthly TDS = 35,750 / 6 = 5958.33
    const result = computeTds({
      regime: 'new',
      ytdEarnings: '600000.00',
      currentEarnings: '100000.00',
      remainingMonths: 5,
      ytdTdsDeducted: '35750.00',
      rule: sampleTdsRule,
    });

    expect(result.projectedAnnualGross).toBe('1200000.00');
    expect(result.netTaxableIncome).toBe('1125000.00');
    expect(result.totalAnnualTax).toBe('71500.00');
    expect(result.ytdTdsPaid).toBe('35750.00');
    expect(result.remainingTax).toBe('35750.00');
    expect(result.tdsThisMonth).toBe('5958.33');
  });

  it('handles previous employer income and TDS seamlessly', () => {
    const result = computeTds({
      regime: 'new',
      ytdEarnings: '200000.00',
      currentEarnings: '100000.00',
      remainingMonths: 4, // 5 months left at current employer
      previousEmployerEarnings: '500000.00',
      previousEmployerTds: '25000.00',
      ytdTdsDeducted: '10000.00',
      rule: sampleTdsRule,
    });

    // Total gross: 2L + 1L + (1L * 4) + 5L = 12L
    expect(result.projectedAnnualGross).toBe('1200000.00');
    expect(result.ytdTdsPaid).toBe('35000.00'); // 10k + 25k
  });

  it('guarantees TDS this month is never negative even if over-deducted', () => {
    const result = computeTds({
      regime: 'new',
      currentEarnings: '50000.00',
      remainingMonths: 2,
      ytdEarnings: '450000.00',
      ytdTdsDeducted: '50000.00', // Already paid more than annual liability
      rule: sampleTdsRule,
    });

    expect(Number(result.tdsThisMonth)).toBe(0);
    expect(result.tdsThisMonth).toBe('0.00');
  });

  it('compares regimes and correctly recommends Old vs New Regime based on deductions', () => {
    // 12 LPA CTC
    // Without deductions, New Regime is usually better.
    const noDeductionsCompare = compareRegimes({
      annualEarnings: 1200000,
      rule: sampleTdsRule,
    });
    expect(noDeductionsCompare.recommendedRegime).toBe('new');

    // With heavy deductions (80C: 1.5L, 24b: 2L, 80D: 50k = 4L total deductions)
    // Old regime taxable: 12L - 50k - 4L = 7.5L
    const highDeductionsCompare = compareRegimes({
      annualEarnings: 1200000,
      verifiedDeductions: {
        '80C': 150000,
        '24b': 200000,
        '80D': 50000,
      },
      rule: sampleTdsRule,
    });
    expect(highDeductionsCompare.recommendedRegime).toBe('old');
    expect(Number(highDeductionsCompare.annualTaxSavings)).toBeGreaterThan(0);
  });
});
