import { Decimal } from 'decimal.js';
import { evaluateFormula } from '../formula/index.js';
import { analyzeFormulaDependencies } from '../formula/dependency-graph.js';
import { ValidationError } from '@hrms/shared';

// Decimal.js setup
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export interface StructureComponentDef {
  code: string;
  name?: string;
  kind: 'earning' | 'deduction' | 'employer_contribution' | 'reimbursement' | 'benefit';
  calc: 'fixed' | 'formula' | 'slab' | 'input';
  formula?: string;
  isBalancing?: boolean;
  roundTarget?: 'rupee' | 'paisa';
  rounding?: 'half_up' | 'floor' | 'ceil';
}

export interface CtcBreakupLine {
  code: string;
  kind: 'earning' | 'deduction' | 'employer_contribution' | 'reimbursement' | 'benefit';
  monthlyAmount: string;
  annualAmount: string;
  isBalancing: boolean;
}

export interface CtcBreakupResult {
  ctcAnnual: string;
  monthlyCtc: string;
  grossMonthlyEarnings: string;
  grossAnnualEarnings: string;
  totalMonthlyEmployerContributions: string;
  totalAnnualEmployerContributions: string;
  netTakeHomeEstimateMonthly: string;
  lines: CtcBreakupLine[];
}

/**
 * Pure calculator for CTC breakup with structure balancing component.
 * Formula dependency graph is evaluated in topological order.
 * Balancing component: Special Allowance = Monthly CTC - other earnings - employer contributions.
 */
export function calculateCtcBreakup(
  ctcAnnualAmount: number | string,
  components: StructureComponentDef[],
): CtcBreakupResult {
  const ctcAnnual = new Decimal(ctcAnnualAmount);
  if (ctcAnnual.lessThan(0)) {
    throw new ValidationError('Annual CTC cannot be negative');
  }

  const monthlyCtc = ctcAnnual.dividedBy(12).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  // 1. Separate regular components and balancing component
  const balancingComp = components.find(c => c.isBalancing);
  const nonBalancingComps = components.filter(c => !c.isBalancing);

  // 2. Build formula map for topological ordering
  const formulaMap: Record<string, string> = {
    CTC: '',
    MONTHLY_CTC: '',
    GROSS: '',
  };
  for (const comp of nonBalancingComps) {
    if (comp.calc === 'formula' && comp.formula) {
      formulaMap[comp.code] = comp.formula;
    } else {
      formulaMap[comp.code] = '';
    }
  }

  const analysis = analyzeFormulaDependencies(formulaMap);
  if (analysis.hasCycle) {
    throw new ValidationError(
      `Cycle detected in salary structure components: ${analysis.cyclePath?.join(' -> ')}`,
    );
  }

  const evalOrder = (analysis.evaluationOrder || nonBalancingComps.map(c => c.code)).filter(
    code => !['CTC', 'MONTHLY_CTC', 'GROSS'].includes(code),
  );

  // 3. Evaluate non-balancing components in dependency order
  const calculatedMonthly: Record<string, Decimal> = {};
  const formulaContext: Record<string, number> = {
    CTC: ctcAnnual.toNumber(),
    MONTHLY_CTC: monthlyCtc.toNumber(),
    GROSS: 0,
  };

  let cumulativeGrossEarnings = new Decimal(0);
  let cumulativeEmployerCost = new Decimal(0);

  for (const code of evalOrder) {
    const comp = nonBalancingComps.find(c => c.code === code);
    if (!comp) continue;

    let monthlyVal = new Decimal(0);

    if (comp.calc === 'formula' && comp.formula) {
      formulaContext.GROSS = cumulativeGrossEarnings.toNumber();
      const rawVal = evaluateFormula(comp.formula, formulaContext);
      monthlyVal = new Decimal(rawVal).toDecimalPlaces(
        comp.roundTarget === 'paisa' ? 2 : 0,
        comp.rounding === 'floor'
          ? Decimal.ROUND_FLOOR
          : comp.rounding === 'ceil'
            ? Decimal.ROUND_CEIL
            : Decimal.ROUND_HALF_UP,
      );
    } else if (comp.calc === 'fixed') {
      monthlyVal = new Decimal(0);
    }

    calculatedMonthly[code] = monthlyVal;
    formulaContext[code] = monthlyVal.toNumber();

    if (comp.kind === 'earning') {
      cumulativeGrossEarnings = cumulativeGrossEarnings.plus(monthlyVal);
    } else if (comp.kind === 'employer_contribution') {
      cumulativeEmployerCost = cumulativeEmployerCost.plus(monthlyVal);
    }
  }

  // 4. Calculate designated balancing component
  if (balancingComp) {
    const balancingMonthly = monthlyCtc
      .minus(cumulativeGrossEarnings)
      .minus(cumulativeEmployerCost)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

    if (balancingMonthly.lessThan(0)) {
      throw new ValidationError(
        `Salary structure balancing error: Computed balancing component '${balancingComp.code}' is negative (${balancingMonthly.toFixed(2)}). Total earnings and employer contributions exceed Monthly CTC (${monthlyCtc.toFixed(2)}).`,
      );
    }

    calculatedMonthly[balancingComp.code] = balancingMonthly;
    formulaContext[balancingComp.code] = balancingMonthly.toNumber();
    cumulativeGrossEarnings = cumulativeGrossEarnings.plus(balancingMonthly);
  }

  // 5. Construct lines
  const lines: CtcBreakupLine[] = components.map(comp => {
    const monthly = calculatedMonthly[comp.code] ?? new Decimal(0);
    const annual = monthly.times(12).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    return {
      code: comp.code,
      kind: comp.kind,
      monthlyAmount: monthly.toFixed(2),
      annualAmount: annual.toFixed(2),
      isBalancing: Boolean(comp.isBalancing),
    };
  });

  const grossAnnual = cumulativeGrossEarnings.times(12).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const totalAnnualEmployer = cumulativeEmployerCost
    .times(12)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  return {
    ctcAnnual: ctcAnnual.toFixed(2),
    monthlyCtc: monthlyCtc.toFixed(2),
    grossMonthlyEarnings: cumulativeGrossEarnings.toFixed(2),
    grossAnnualEarnings: grossAnnual.toFixed(2),
    totalMonthlyEmployerContributions: cumulativeEmployerCost.toFixed(2),
    totalAnnualEmployerContributions: totalAnnualEmployer.toFixed(2),
    netTakeHomeEstimateMonthly: cumulativeGrossEarnings.toFixed(2), // Pre-tax baseline
    lines,
  };
}
