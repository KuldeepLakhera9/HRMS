'use client';

import React, { useState } from 'react';

interface DiffRow {
  id: string;
  empCode: string;
  name: string;
  component: string;
  ours: number;
  theirs: number;
  diff: number;
  category: 'rounding' | 'rule_difference' | 'input_difference' | 'engine_bug' | 'source_error' | 'timing';
  status: 'open' | 'explained' | 'accepted' | 'fixed';
  explanation?: string;
}

export default function ReconciliationPage() {
  const [cycleStatus, setCycleStatus] = useState<'open' | 'in_review' | 'signed'>('in_review');
  const [tolerance, setTolerance] = useState('1.00');
  const [signedByCa, setSignedByCa] = useState(false);
  const [signedByFinance, setSignedByFinance] = useState(false);

  const [diffs, _setDiffs] = useState<DiffRow[]>([
    {
      id: 'diff-1',
      empCode: 'EMP00101',
      name: 'Rahul Verma',
      component: 'BASIC',
      ours: 50000,
      theirs: 50000,
      diff: 0,
      category: 'rounding',
      status: 'accepted',
      explanation: 'Exact match',
    },
    {
      id: 'diff-2',
      empCode: 'EMP00102',
      name: 'Anita Desai',
      component: 'HRA',
      ours: 20000.5,
      theirs: 20000.0,
      diff: 0.5,
      category: 'rounding',
      status: 'accepted',
      explanation: 'Variance ₹0.50 within agreed tolerance of ₹1.00',
    },
    {
      id: 'diff-3',
      empCode: 'EMP00103',
      name: 'Vikram Rao',
      component: 'EPF',
      ours: 1800,
      theirs: 1800,
      diff: 0,
      category: 'rounding',
      status: 'accepted',
      explanation: 'Exact match',
    },
    {
      id: 'diff-4',
      empCode: 'EMP00104',
      name: 'Priya Sharma',
      component: 'TDS',
      ours: 28500,
      theirs: 28650,
      diff: -150,
      category: 'rule_difference',
      status: 'explained',
      explanation: 'Legacy system applied 50k standard deduction instead of 75k under new regime',
    },
  ]);

  const handleSignoff = (role: 'ca' | 'finance') => {
    if (role === 'ca') {
      setSignedByCa(true);
      if (signedByFinance) setCycleStatus('signed');
    } else {
      setSignedByFinance(true);
      if (signedByCa) setCycleStatus('signed');
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Parallel-Run Reconciliation Console (Cycle 1)
          </h1>
          <p className="text-sm text-muted-foreground">
            Compare existing payroll outputs against the HRMS engine with tolerance-based diffing and dual CA/Finance sign-off.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${
              cycleStatus === 'signed'
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-400'
                : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-400'
            }`}
          >
            CYCLE STATUS: {cycleStatus.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="text-xs font-medium text-muted-foreground uppercase">Employees Compared</div>
          <div className="text-2xl font-bold text-foreground mt-1">4 Employees</div>
          <div className="text-xs text-muted-foreground mt-1">16 component comparisons</div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="text-xs font-medium text-muted-foreground uppercase">Exact Matching Rate</div>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">93.75%</div>
          <div className="text-xs text-muted-foreground mt-1">15/16 matched or within tolerance</div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="text-xs font-medium text-muted-foreground uppercase">Total Absolute Variance</div>
          <div className="text-2xl font-bold text-foreground mt-1">₹150.50</div>
          <div className="text-xs text-muted-foreground mt-1">Tolerance threshold: ₹{tolerance}</div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="text-xs font-medium text-muted-foreground uppercase">Unexplained Diff Count</div>
          <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">0 Open</div>
          <div className="text-xs text-muted-foreground mt-1">All variances explained & accepted</div>
        </div>
      </div>

      {/* Sign-off & Workflow Box */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Dual Segregation-of-Duties Sign-Off</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Both the Chartered Accountant (CA) and Finance Lead must independently sign off after explaining all variances.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={signedByCa}
            onClick={() => handleSignoff('ca')}
            className={`px-4 py-2 rounded-md text-xs font-semibold transition ${
              signedByCa
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-400'
                : 'bg-emerald-700 text-white hover:bg-emerald-800'
            }`}
          >
            {signedByCa ? '✓ Signed by CA' : 'Sign-Off as CA'}
          </button>

          <button
            type="button"
            disabled={signedByFinance}
            onClick={() => handleSignoff('finance')}
            className={`px-4 py-2 rounded-md text-xs font-semibold transition ${
              signedByFinance
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-400'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
          >
            {signedByFinance ? '✓ Signed by Finance' : 'Sign-Off as Finance Lead'}
          </button>
        </div>
      </div>

      {/* Component Diff Table */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border flex justify-between items-center bg-muted/20">
          <h3 className="font-semibold text-sm text-foreground">Line-by-Line Component Comparison</h3>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Tolerance:</span>
            <select
              value={tolerance}
              onChange={e => setTolerance(e.target.value)}
              className="h-8 rounded border border-input bg-background px-2 text-xs"
            >
              <option value="1.00">₹1.00 (Default)</option>
              <option value="5.00">₹5.00</option>
              <option value="0.00">₹0.00 (Strict)</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-xs font-semibold text-muted-foreground uppercase">
                <th className="p-4">Employee</th>
                <th className="p-4">Component</th>
                <th className="p-4">HRMS Output (₹)</th>
                <th className="p-4">Legacy Output (₹)</th>
                <th className="p-4">Variance (₹)</th>
                <th className="p-4">Category</th>
                <th className="p-4">Status & Explanation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {diffs.map(d => (
                <tr key={d.id} className="hover:bg-muted/10 transition">
                  <td className="p-4">
                    <div className="font-medium text-foreground">{d.name}</div>
                    <div className="text-xs text-muted-foreground">{d.empCode}</div>
                  </td>
                  <td className="p-4 font-semibold text-foreground">{d.component}</td>
                  <td className="p-4">₹{d.ours.toLocaleString('en-IN')}</td>
                  <td className="p-4">₹{d.theirs.toLocaleString('en-IN')}</td>
                  <td className="p-4">
                    <span
                      className={`font-semibold ${
                        d.diff === 0
                          ? 'text-foreground'
                          : Math.abs(d.diff) <= Number(tolerance)
                          ? 'text-muted-foreground'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {d.diff > 0 ? `+${d.diff.toFixed(2)}` : d.diff.toFixed(2)}
                    </span>
                  </td>
                  <td className="p-4">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-foreground">
                      {d.category.replace('_', ' ').toUpperCase()}
                    </span>
                  </td>
                  <td className="p-4">
                    <div className="text-xs font-medium text-foreground">{d.explanation}</div>
                    <span
                      className={`inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        d.status === 'accepted'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {d.status.toUpperCase()}
                    </span>
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
