'use client';

import React, { useState } from 'react';

interface DeductionItem {
  code: string;
  label: string;
  section: string;
  maxLimit: string;
  declared: number;
  verified: number;
  status: 'none' | 'uploaded' | 'verified' | 'rejected';
}

export default function TaxDeclarationsPage() {
  const [regime, setRegime] = useState<'new' | 'old'>('new');
  const [fy, _setFy] = useState('2026-2027');
  const [grossAnnual, setGrossAnnual] = useState('1800000');
  const [isComparing, setIsComparing] = useState(false);
  const [comparisonResult, setComparisonResult] = useState<{
    newTax: number;
    oldTax: number;
    savings: number;
    recommendation: string;
  } | null>(null);

  const [items, setItems] = useState<DeductionItem[]>([
    { code: '80C', label: 'Section 80C (PPF, ELSS, EPF, Life Insurance)', section: '80C', maxLimit: '₹1,50,000', declared: 150000, verified: 150000, status: 'verified' },
    { code: '80CCD_1B', label: 'Section 80CCD(1B) - NPS Tier-1', section: '80CCD', maxLimit: '₹50,000', declared: 50000, verified: 50000, status: 'verified' },
    { code: '80D', label: 'Section 80D - Medical Insurance Premium', section: '80D', maxLimit: '₹50,000', declared: 25000, verified: 25000, status: 'verified' },
    { code: '24B', label: 'Section 24(b) - Home Loan Interest', section: '24(b)', maxLimit: '₹2,000,000', declared: 120000, verified: 0, status: 'uploaded' },
  ]);

  const handleCompare = () => {
    setIsComparing(true);
    // Pure calculation simulation for UI display
    const gross = Number(grossAnnual) || 1800000;
    // New regime: standard deduction 75,000
    const newTaxable = Math.max(0, gross - 75000);
    // Old regime: standard deduction 50,000 + deductions
    const totalDeds = items.reduce((acc, i) => acc + (i.declared || 0), 0);
    const oldTaxable = Math.max(0, gross - 50000 - totalDeds);

    const newTax = Math.round(newTaxable * 0.15); // Approximate slab average
    const oldTax = Math.round(oldTaxable * 0.20);
    const savings = Math.abs(oldTax - newTax);
    const recommendation = newTax <= oldTax ? 'New Tax Regime' : 'Old Tax Regime';

    setTimeout(() => {
      setComparisonResult({ newTax, oldTax, savings, recommendation });
      setIsComparing(false);
    }, 300);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Tax Declarations & Regime Choice
          </h1>
          <p className="text-sm text-muted-foreground">
            Choose your tax regime (Form 122), declare Chapter VI-A deductions, and upload investment proofs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-400">
            FY {fy} Window Open
          </span>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-400">
            Status: Submitted
          </span>
        </div>
      </div>

      {/* Regime Selector & Comparison Card */}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground mb-4">Tax Regime Selection (Form 122)</h2>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setRegime('new')}
                className={`p-4 rounded-lg border text-left transition-all ${
                  regime === 'new'
                    ? 'border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/20 ring-2 ring-emerald-500'
                    : 'border-border hover:border-muted-foreground'
                }`}
              >
                <div className="font-semibold text-foreground">New Tax Regime (Default)</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Lower slab rates, ₹75,000 standard deduction, Section 392 simplified tax.
                </div>
              </button>

              <button
                type="button"
                onClick={() => setRegime('old')}
                className={`p-4 rounded-lg border text-left transition-all ${
                  regime === 'old'
                    ? 'border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/20 ring-2 ring-emerald-500'
                    : 'border-border hover:border-muted-foreground'
                }`}
              >
                <div className="font-semibold text-foreground">Old Tax Regime</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Allows 80C, 80D, HRA exemption, and home loan interest deductions.
                </div>
              </button>
            </div>

            <div className="pt-2">
              <label className="text-xs font-medium text-muted-foreground">Estimated Annual Gross Salary (₹)</label>
              <div className="flex gap-2 mt-1">
                <input
                  type="text"
                  value={grossAnnual}
                  onChange={e => setGrossAnnual(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                />
                <button
                  type="button"
                  onClick={handleCompare}
                  disabled={isComparing}
                  className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 transition"
                >
                  {isComparing ? 'Computing...' : 'Compare Regimes'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Comparison Summary Panel */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground mb-4">Regime Comparison Calculator</h2>
            {comparisonResult ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-muted/40 rounded-lg">
                    <div className="text-xs text-muted-foreground">New Regime Projected Tax</div>
                    <div className="text-xl font-bold text-foreground">₹{comparisonResult.newTax.toLocaleString('en-IN')}</div>
                  </div>
                  <div className="p-3 bg-muted/40 rounded-lg">
                    <div className="text-xs text-muted-foreground">Old Regime Projected Tax</div>
                    <div className="text-xl font-bold text-foreground">₹{comparisonResult.oldTax.toLocaleString('en-IN')}</div>
                  </div>
                </div>

                <div className="p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-lg">
                  <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-400 uppercase tracking-wider">
                    Recommendation
                  </div>
                  <div className="text-sm font-medium text-foreground mt-1">
                    {comparisonResult.recommendation} is more beneficial, saving approximately{' '}
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      ₹{comparisonResult.savings.toLocaleString('en-IN')}
                    </span>{' '}
                    per year.
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground py-8 text-center">
                Click &ldquo;Compare Regimes&rdquo; to simulate your annual TDS liability under both the New and Old tax regimes using the computeTds engine.
              </div>
            )}
          </div>
          <div className="text-xs text-muted-foreground border-t border-border pt-3 mt-4">
            Under Income-tax Act 2025, salaried TDS is governed by Section 392.
          </div>
        </div>
      </div>

      {/* Deduction Catalog & Declaration Items */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="p-6 border-b border-border flex justify-between items-center">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Chapter VI-A & Other Deductions</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Declarations are applicable under Old Regime. Verified amounts flow directly into monthly TDS computations.
            </p>
          </div>
          <button
            type="button"
            className="px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-md hover:bg-emerald-800 transition"
          >
            Save Declarations
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-xs font-semibold text-muted-foreground uppercase">
                <th className="p-4">Deduction Code & Description</th>
                <th className="p-4">Statutory Limit</th>
                <th className="p-4">Declared (₹)</th>
                <th className="p-4">Verified (₹)</th>
                <th className="p-4">Proof Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((item, index) => (
                <tr key={item.code} className="hover:bg-muted/10 transition">
                  <td className="p-4">
                    <div className="font-medium text-foreground">{item.code}</div>
                    <div className="text-xs text-muted-foreground">{item.label}</div>
                  </td>
                  <td className="p-4 text-muted-foreground">{item.maxLimit}</td>
                  <td className="p-4">
                    <input
                      type="number"
                      value={item.declared}
                      onChange={e => {
                        const val = Number(e.target.value) || 0;
                        setItems(prev => {
                          const copy = [...prev];
                          copy[index].declared = val;
                          return copy;
                        });
                      }}
                      className="h-8 w-28 rounded border border-input bg-background px-2 text-sm"
                    />
                  </td>
                  <td className="p-4 font-semibold text-foreground">
                    ₹{item.verified.toLocaleString('en-IN')}
                  </td>
                  <td className="p-4">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        item.status === 'verified'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-400'
                          : item.status === 'uploaded'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-400'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {item.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    <button
                      type="button"
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Upload Proof
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
