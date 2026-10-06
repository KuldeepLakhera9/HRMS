'use client';

import React, { useEffect, useState } from 'react';
import {
  GitCommit,
  Calculator,
  CheckCircle2,
  AlertCircle,
  Clock,
  AlertTriangle,
  Play,
} from 'lucide-react';

interface StructureItem {
  id: string;
  name: string;
  version: number;
  status: 'draft' | 'approved' | 'retired';
  components: Array<{
    code: string;
    calc?: string;
    formula?: string;
    isBalancing?: boolean;
  }>;
}

interface SimulationResult {
  ctcAnnual: string;
  monthlyCtc: string;
  grossMonthlyEarnings: string;
  grossAnnualEarnings: string;
  totalMonthlyEmployerContributions: string;
  totalAnnualEmployerContributions: string;
  netTakeHomeEstimateMonthly: string;
  labourCodeFloorWarning: boolean;
  lines: Array<{
    code: string;
    kind: string;
    monthlyAmount: string;
    annualAmount: string;
    isBalancing: boolean;
  }>;
}

export default function SalaryStructuresPage() {
  const [structures, setStructures] = useState<StructureItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Simulation State
  const [selectedStructureId, setSelectedStructureId] = useState<string | null>(null);
  const [simCtcAnnual, setSimCtcAnnual] = useState('600000');
  const [simulating, setSimulating] = useState(false);
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);

  const loadStructures = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/v1/payroll/structures');
      if (!res.ok) throw new Error('Failed to fetch salary structures');
      const json = await res.json();
      const list = json.data || [];
      setStructures(list);
      if (list.length > 0 && !selectedStructureId) {
        setSelectedStructureId(list[0].id);
      }
    } catch (err: unknown) {
      setErrorMsg((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStructures();
  }, []);

  const handleSimulate = async () => {
    if (!selectedStructureId) return;
    try {
      setSimulating(true);
      setErrorMsg(null);
      const res = await fetch(`/api/v1/payroll/structures/${selectedStructureId}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ctcAnnual: simCtcAnnual }),
      });
      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.message || 'Simulation failed');
      }
      const json = await res.json();
      setSimResult(json.data);
    } catch (err: unknown) {
      setErrorMsg((err as Error).message);
    } finally {
      setSimulating(false);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      setErrorMsg(null);
      setSuccessMsg(null);
      const res = await fetch(`/api/v1/payroll/structures/${id}/approve`, {
        method: 'POST',
      });
      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.message || 'Failed to approve structure');
      }
      setSuccessMsg('Salary structure approved successfully');
      setTimeout(() => setSuccessMsg(null), 4000);
      loadStructures();
    } catch (err: unknown) {
      setErrorMsg((err as Error).message);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Salary Structures & CTC Simulator
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Define compensation frameworks with auto-balancing allowances and Code on Wages validation.
        </p>
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

      {/* CTC Simulator Panel */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-6">
        <div className="flex items-center gap-2 pb-2 border-b border-border">
          <Calculator className="w-5 h-5 text-primary" />
          <h2 className="text-base font-semibold text-foreground">Interactive CTC Breakup Calculator</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Select Structure
            </label>
            <select
              className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              value={selectedStructureId || ''}
              onChange={e => setSelectedStructureId(e.target.value)}
            >
              {structures.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} (v{s.version}) - {s.status}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Annual Cost to Company (₹ CTC)
            </label>
            <input
              type="number"
              className="w-full h-10 px-3 font-mono text-sm rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
              value={simCtcAnnual}
              onChange={e => setSimCtcAnnual(e.target.value)}
            />
          </div>

          <div className="flex items-end">
            <button
              onClick={handleSimulate}
              disabled={simulating || !selectedStructureId}
              className="w-full flex items-center justify-center gap-2 h-10 px-4 bg-primary text-primary-foreground font-medium text-sm rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <Play className="w-4 h-4" />
              {simulating ? 'Calculating...' : 'Simulate Breakup'}
            </button>
          </div>
        </div>

        {/* Simulation Output */}
        {simResult && (
          <div className="space-y-4 pt-4 border-t border-border">
            {simResult.labourCodeFloorWarning && (
              <div className="flex items-center gap-3 p-3.5 bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 rounded-xl text-xs">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>
                  <strong>Code on Wages Warning:</strong> Basic wage in this structure is less than
                  50% of monthly earnings. Excess allowances will be added back for statutory wage
                  assessment.
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-xl bg-muted/30">
              <div>
                <span className="text-xs text-muted-foreground">Monthly CTC</span>
                <div className="text-lg font-semibold font-mono text-foreground">
                  ₹{simResult.monthlyCtc}
                </div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Monthly Gross</span>
                <div className="text-lg font-semibold font-mono text-foreground">
                  ₹{simResult.grossMonthlyEarnings}
                </div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Monthly Employer Cost</span>
                <div className="text-lg font-semibold font-mono text-foreground">
                  ₹{simResult.totalMonthlyEmployerContributions}
                </div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Take-Home Estimate</span>
                <div className="text-lg font-semibold font-mono text-primary">
                  ₹{simResult.netTakeHomeEstimateMonthly}
                </div>
              </div>
            </div>

            {/* Component Line Breakdown Table */}
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/50 text-muted-foreground uppercase font-medium">
                  <tr>
                    <th className="px-4 py-2.5">Component</th>
                    <th className="px-4 py-2.5">Type</th>
                    <th className="px-4 py-2.5 text-right">Monthly (₹)</th>
                    <th className="px-4 py-2.5 text-right">Annual (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {simResult.lines.map(line => (
                    <tr key={line.code} className="hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-medium font-mono text-foreground">
                        {line.code}
                        {line.isBalancing && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-sans">
                            Balancing Allowance
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 capitalize text-muted-foreground">
                        {line.kind.replace('_', ' ')}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-right text-foreground">
                        ₹{line.monthlyAmount}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-right text-muted-foreground">
                        ₹{line.annualAmount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Salary Structures Table */}
      <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitCommit className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">Configured Structures</h2>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider border-b border-border">
              <tr>
                <th className="px-6 py-3 font-medium">Structure Name</th>
                <th className="px-6 py-3 font-medium">Version</th>
                <th className="px-6 py-3 font-medium">Component Count</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground animate-pulse">
                    Loading structures...
                  </td>
                </tr>
              ) : structures.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                    No salary structures registered yet.
                  </td>
                </tr>
              ) : (
                structures.map(struct => (
                  <tr key={struct.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-6 py-4 font-medium text-foreground">{struct.name}</td>
                    <td className="px-6 py-4 font-mono text-xs text-muted-foreground">
                      v{struct.version}
                    </td>
                    <td className="px-6 py-4 text-xs text-muted-foreground">
                      {struct.components?.length || 0} components
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
                          struct.status === 'approved'
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                            : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                        }`}
                      >
                        {struct.status === 'approved' ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : (
                          <Clock className="w-3.5 h-3.5" />
                        )}
                        <span className="capitalize">{struct.status}</span>
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {struct.status === 'draft' ? (
                        <button
                          onClick={() => handleApprove(struct.id)}
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
