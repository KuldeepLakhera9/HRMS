'use client';

import React, { useEffect, useState } from 'react';
import {
  Play,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
  Layers,
  Check,
} from 'lucide-react';

interface SalaryComponentItem {
  id: string;
  code: string;
  name: string;
  kind: 'earning' | 'deduction' | 'employer_contribution' | 'reimbursement';
  calc: 'fixed' | 'formula' | 'slab' | 'input';
  formula: string | null;
  status: 'draft' | 'approved';
  version: number;
  pfWage: boolean;
  esiWage: boolean;
  taxable: boolean;
  createdBy: string;
}

export default function SalaryComponentsPage() {
  const [components, setComponents] = useState<SalaryComponentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Formula Sandbox State
  const [sandboxFormula, setSandboxFormula] = useState('BASIC * 0.40');
  const [sandboxVariables, setSandboxVariables] = useState('{\n  "BASIC": 25000\n}');
  const [sandboxResult, setSandboxResult] = useState<{
    valid: boolean;
    result?: string;
    error?: string;
  } | null>(null);
  const [testingFormula, setTestingFormula] = useState(false);

  const loadComponents = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/v1/payroll/components');
      if (!res.ok) throw new Error('Failed to fetch salary components');
      const json = await res.json();
      setComponents(json.data || []);
    } catch (err: unknown) {
      setErrorMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadComponents();
  }, []);

  const handleApprove = async (id: string) => {
    try {
      setErrorMsg(null);
      setSuccessMsg(null);
      const res = await fetch(`/api/v1/payroll/components/${id}/approve`, {
        method: 'POST',
      });
      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.message || 'Failed to approve component');
      }
      setSuccessMsg('Salary component approved successfully');
      setTimeout(() => setSuccessMsg(null), 4000);
      loadComponents();
    } catch (err: unknown) {
      setErrorMsg((err as Error).message);
    }
  };

  const handleTestFormula = async () => {
    try {
      setTestingFormula(true);
      setSandboxResult(null);
      let parsedVars: Record<string, number> = {};
      try {
        parsedVars = JSON.parse(sandboxVariables);
      } catch {
        throw new Error('Variables must be valid JSON');
      }

      const res = await fetch('/api/v1/payroll/components/test-formula', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formula: sandboxFormula,
          sampleVariables: parsedVars,
        }),
      });

      const json = await res.json();
      setSandboxResult(json.data);
    } catch (err: unknown) {
      setSandboxResult({ valid: false, error: (err as Error).message });
    } finally {
      setTestingFormula(false);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Salary Components & Formula Engine
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure earnings, deductions, and statutory wage flags with Pratt formula evaluation.
          </p>
        </div>
      </div>

      {successMsg && (
        <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-xl text-sm">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/20 text-destructive rounded-xl text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Formula Testing Sandbox */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2 pb-2 border-b border-border">
          <Sparkles className="w-5 h-5 text-primary" />
          <h2 className="text-base font-semibold text-foreground">Live Formula Test Sandbox</h2>
          <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
            Pratt AST Engine
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Formula Expression (e.g. BASIC * 0.40, min(BASIC, 15000))
            </label>
            <input
              type="text"
              className="w-full h-10 px-3 font-mono text-sm rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20"
              value={sandboxFormula}
              onChange={e => setSandboxFormula(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Sample Variables (JSON)
            </label>
            <textarea
              rows={2}
              className="w-full p-2 font-mono text-xs rounded-lg border border-border bg-background focus:ring-2 focus:ring-primary/20"
              value={sandboxVariables}
              onChange={e => setSandboxVariables(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <button
            onClick={handleTestFormula}
            disabled={testingFormula}
            className="flex items-center gap-2 px-4 py-2 bg-primary/10 text-primary hover:bg-primary/20 font-medium text-xs rounded-lg transition-colors disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" />
            {testingFormula ? 'Evaluating...' : 'Evaluate Formula AST'}
          </button>

          {sandboxResult && (
            <div
              className={`flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded-lg border ${
                sandboxResult.valid
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                  : 'bg-destructive/10 border-destructive/20 text-destructive'
              }`}
            >
              {sandboxResult.valid ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Result: ₹{sandboxResult.result}</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-4 h-4" />
                  <span>Error: {sandboxResult.error}</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Salary Components Table */}
      <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">Registered Components</h2>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider border-b border-border">
              <tr>
                <th className="px-6 py-3 font-medium">Code</th>
                <th className="px-6 py-3 font-medium">Name</th>
                <th className="px-6 py-3 font-medium">Kind</th>
                <th className="px-6 py-3 font-medium">Calculation</th>
                <th className="px-6 py-3 font-medium">Formula</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-muted-foreground animate-pulse">
                    Loading salary components...
                  </td>
                </tr>
              ) : components.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">
                    No salary components registered yet.
                  </td>
                </tr>
              ) : (
                components.map(comp => (
                  <tr key={comp.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-6 py-4 font-mono font-medium text-foreground">{comp.code}</td>
                    <td className="px-6 py-4 text-foreground">{comp.name}</td>
                    <td className="px-6 py-4">
                      <span className="capitalize text-xs px-2.5 py-1 rounded-full font-medium bg-muted text-muted-foreground">
                        {comp.kind.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs font-mono uppercase text-muted-foreground">
                      {comp.calc}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-muted-foreground max-w-xs truncate">
                      {comp.formula || '—'}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
                          comp.status === 'approved'
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                            : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                        }`}
                      >
                        {comp.status === 'approved' ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : (
                          <Clock className="w-3.5 h-3.5" />
                        )}
                        <span className="capitalize">{comp.status}</span>
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {comp.status === 'draft' ? (
                        <button
                          onClick={() => handleApprove(comp.id)}
                          className="px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-lg hover:bg-primary/90 transition-colors shadow-xs"
                        >
                          Approve (Checker)
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">Locked</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
