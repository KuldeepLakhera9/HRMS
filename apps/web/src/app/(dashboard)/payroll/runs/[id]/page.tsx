'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Calculator,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';

interface RunSummary {
  runId: string;
  status: string;
  headcount: number;
  includedCount: number;
  heldCount: number;
  excludedCount: number;
  errorCount: number;
  blockersCount: number;
  warningsCount: number;
  totals: {
    gross: string;
    deductions: string;
    employerCost: string;
    net: string;
  };
  heldTotals: {
    gross: string;
    net: string;
  };
  canApprove: boolean;
  canLock: boolean;
  canCalculate: boolean;
}

interface StagedEmployee {
  id: string;
  employeeId: string;
  empCode: string;
  firstName: string;
  lastName: string;
  emailWork: string;
  status: 'included' | 'held' | 'excluded' | 'error';
  holdReason: string | null;
  gross: string;
  deductions: string;
  employerCost: string;
  net: string;
  blockers: string[];
  warnings: string[];
  inputHash: string | null;
  calcVersion: number;
}

interface VarianceRecord {
  employeeId: string;
  empCode: string;
  firstName: string;
  lastName: string;
  emailWork: string;
  currentStatus: string;
  currentGross: string;
  currentNet: string;
  priorGross: string;
  priorNet: string;
  grossDiff: string;
  grossPctChange: number;
  varianceCategory: 'NEW_JOINER' | 'LEAVER_OR_EXCLUDED' | 'VARIANCE' | 'UNCHANGED' | 'FIRST_PAYROLL';
}

interface ExplainData {
  employee: {
    id: string;
    empCode: string;
    name: string;
    email: string;
    status: string;
    holdReason: string | null;
  };
  summary: {
    gross: string;
    deductions: string;
    reimbursements: string;
    net: string;
    employerCost: string;
    payableDays: number;
    payableRatio: string;
  };
  lines: {
    earnings: Array<{ code: string; name: string; amount: string; taxableAmount: string; ruleRef?: string }>;
    deductions: Array<{ code: string; name: string; amount: string; ruleRef?: string }>;
    employerContributions: Array<{ code: string; name: string; amount: string }>;
    reimbursements: Array<{ code: string; name: string; amount: string }>;
  };
  warnings: string[];
  blockers: string[];
  inputHash: string | null;
  calcVersion: number;
}

interface SimulationResult {
  gross: string;
  deductions: string;
  net: string;
  employerCost?: string;
  lines?: Array<{
    code: string;
    name: string;
    amount: string;
    kind: string;
  }>;
}

export default function PayrollRunConsolePage() {
  const params = useParams();
  const runId = params.id as string;

  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [employees, setEmployees] = useState<StagedEmployee[]>([]);
  const [variance, setVariance] = useState<VarianceRecord[]>([]);
  const [priorPeriod, setPriorPeriod] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'staged' | 'variance' | 'blockers' | 'makerChecker'>('staged');

  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [_loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [calcProgress, setCalcProgress] = useState<{ current: number; total: number; percentage: number } | null>(null);

  // Explain modal state
  const [explainModalOpen, setExplainModalOpen] = useState(false);
  const [explainData, setExplainData] = useState<ExplainData | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);

  // Simulate modal state
  const [simulateModalOpen, setSimulateModalOpen] = useState(false);
  const [simulateEmp, setSimulateEmp] = useState<StagedEmployee | null>(null);
  const [simPaidDays, setSimPaidDays] = useState<number>(30);
  const [simLopDays, setSimLopDays] = useState<number>(0);
  const [simBonusAmount, setSimBonusAmount] = useState<number>(0);
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [simulating, setSimulating] = useState(false);

  // Hold reason modal state
  const [holdModalOpen, setHoldModalOpen] = useState(false);
  const [holdTargetEmpId, setHoldTargetEmpId] = useState<string | null>(null);
  const [holdReasonText, setHoldReasonText] = useState('');

  // Fetch summary & initial data
  const refreshData = async () => {
    try {
      setLoading(true);
      const [sumRes, empRes] = await Promise.all([
        fetch(`/api/v1/payroll/runs/${runId}/summary`),
        fetch(`/api/v1/payroll/runs/${runId}/employees?limit=100`),
      ]);

      if (sumRes.ok) {
        const sumJson = await sumRes.json();
        setSummary(sumJson.data);
      }
      if (empRes.ok) {
        const empJson = await empRes.json();
        setEmployees(empJson.data.items || []);
      }
    } catch (err) {
      console.error('Error fetching run data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!runId) return;
    refreshData();
  }, [runId]);

  // Load variance when variance tab selected
  useEffect(() => {
    if (activeTab === 'variance' && variance.length === 0) {
      async function fetchVariance() {
        try {
          const res = await fetch(`/api/v1/payroll/runs/${runId}/variance?limit=100`);
          if (res.ok) {
            const json = await res.json();
            setVariance(json.data.items || []);
            setPriorPeriod(json.data.priorPeriod);
          }
        } catch (err) {
          console.error('Error fetching variance:', err);
        }
      }
      fetchVariance();
    }
  }, [activeTab, runId, variance.length]);

  // SSE Live Calculation listener
  const startLiveCalculation = async () => {
    try {
      setCalculating(true);
      setCalcProgress({ current: 0, total: summary?.headcount || 100, percentage: 0 });

      // Start SSE listener
      const eventSource = new EventSource(`/api/v1/payroll/runs/${runId}/stream`);

      eventSource.onmessage = e => {
        try {
          const data = JSON.parse(e.data);
          if (data.percentage !== undefined) {
            setCalcProgress({
              current: data.current,
              total: data.total,
              percentage: data.percentage,
            });
          }
          if (data.status === 'completed') {
            eventSource.close();
            setCalculating(false);
            setCalcProgress(null);
            refreshData();
          }
        } catch {
          // Ignore JSON parse error on partial SSE chunk
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
      };

      // Trigger calculate API
      const res = await fetch(`/api/v1/payroll/runs/${runId}/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceRecalculate: true }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to trigger calculation');
      }

      await res.json();
      eventSource.close();
      setCalculating(false);
      setCalcProgress(null);
      await refreshData();
    } catch (err) {
      alert((err as Error).message);
      setCalculating(false);
      setCalcProgress(null);
    }
  };

  // State transitions
  const handleTransition = async (toStatus: string) => {
    try {
      const res = await fetch(`/api/v1/payroll/runs/${runId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: runId, toStatus }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `Failed transition to ${toStatus}`);
      }
      await refreshData();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  // Hold / Release
  const handleHoldConfirm = async () => {
    if (!holdTargetEmpId || !holdReasonText.trim()) return;
    try {
      const res = await fetch(`/api/v1/payroll/runs/${runId}/employees/${holdTargetEmpId}/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: runId, empId: holdTargetEmpId, reason: holdReasonText.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to hold employee');
      }
      setHoldModalOpen(false);
      setHoldTargetEmpId(null);
      setHoldReasonText('');
      await refreshData();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  const handleRelease = async (empId: string) => {
    try {
      const res = await fetch(`/api/v1/payroll/runs/${runId}/employees/${empId}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: runId, empId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to release employee');
      }
      await refreshData();
    } catch (err) {
      alert((err as Error).message);
    }
  };

  // Explain payslip
  const handleOpenExplain = async (empId: string) => {
    setExplainModalOpen(true);
    setExplainLoading(true);
    try {
      const res = await fetch(`/api/v1/payroll/runs/${runId}/employees/${empId}/explain`);
      if (!res.ok) throw new Error('Failed to load derivation explanation');
      const json = await res.json();
      setExplainData(json.data);
    } catch (err) {
      alert((err as Error).message);
      setExplainModalOpen(false);
    } finally {
      setExplainLoading(false);
    }
  };

  // Simulate payslip
  const handleOpenSimulate = (emp: StagedEmployee) => {
    setSimulateEmp(emp);
    setSimPaidDays(30);
    setSimLopDays(0);
    setSimBonusAmount(0);
    setSimResult(null);
    setSimulateModalOpen(true);
  };

  const handleRunSimulation = async () => {
    if (!simulateEmp) return;
    try {
      setSimulating(true);
      const additionalInputs = simBonusAmount > 0 ? [{ type: 'bonus', amount: simBonusAmount }] : [];
      const res = await fetch(`/api/v1/payroll/runs/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId,
          employeeId: simulateEmp.employeeId,
          paidDays: simPaidDays,
          lopDays: simLopDays,
          additionalInputs,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Simulation failed');
      }
      const json = await res.json();
      setSimResult(json.data);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSimulating(false);
    }
  };

  const filteredEmployees = employees.filter(emp => {
    if (filterStatus === 'held' && emp.status !== 'held') return false;
    if (filterStatus === 'included' && emp.status !== 'included') return false;
    if (filterStatus === 'blockers' && emp.blockers.length === 0) return false;
    if (filterStatus === 'warnings' && emp.warnings.length === 0) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchName = `${emp.firstName} ${emp.lastName}`.toLowerCase().includes(q);
      const matchCode = emp.empCode.toLowerCase().includes(q);
      const matchEmail = emp.emailWork.toLowerCase().includes(q);
      if (!matchName && !matchCode && !matchEmail) return false;
    }
    return true;
  });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Navigation & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <Link
            href="/payroll/runs"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary mb-2 hover:underline"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Payroll Cycles
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Payroll Run Console
            </h1>
            <span
              className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                summary?.status === 'locked'
                  ? 'bg-purple-100 text-purple-900 border border-purple-200'
                  : summary?.status === 'approved'
                  ? 'bg-emerald-100 text-emerald-900 border border-emerald-200'
                  : summary?.status === 'calculated'
                  ? 'bg-blue-100 text-blue-900 border border-blue-200'
                  : summary?.status === 'calculating'
                  ? 'bg-amber-100 text-amber-900 border border-amber-200 animate-pulse'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {summary?.status || 'Loading...'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Run ID: <code className="bg-muted px-1.5 py-0.5 rounded">{runId}</code>
          </p>
        </div>

        {/* Workflow Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={startLiveCalculation}
            disabled={calculating || ['locked', 'closed', 'paid'].includes(summary?.status || '')}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground font-semibold rounded-lg text-xs hover:opacity-90 disabled:opacity-50 transition shadow-sm"
          >
            <Calculator className={`w-3.5 h-3.5 ${calculating ? 'animate-spin' : ''}`} />
            {calculating ? 'Calculating...' : 'Calculate All'}
          </button>

          {summary?.status === 'calculated' && (
            <button
              onClick={() => handleTransition('approved')}
              disabled={!summary.canApprove}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-700 text-white font-semibold rounded-lg text-xs hover:bg-emerald-800 disabled:opacity-50 transition shadow-sm"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Approve Run
            </button>
          )}

          {summary?.status === 'approved' && (
            <button
              onClick={() => handleTransition('locked')}
              className="flex items-center gap-1.5 px-4 py-2 bg-purple-700 text-white font-semibold rounded-lg text-xs hover:bg-purple-800 transition shadow-sm"
            >
              <Lock className="w-3.5 h-3.5" />
              Materialize & Seal Payslips
            </button>
          )}

          <button
            onClick={refreshData}
            className="p-2 border rounded-lg text-foreground hover:bg-muted transition"
            title="Refresh run data"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Live Calculation Progress Banner */}
      {calcProgress && (
        <div className="p-4 bg-primary/10 border border-primary/20 rounded-2xl space-y-2">
          <div className="flex justify-between text-xs font-semibold text-primary">
            <span>Executing Pure Salary Engine in 100-Employee Chunks</span>
            <span>
              {calcProgress.current} / {calcProgress.total} ({calcProgress.percentage}%)
            </span>
          </div>
          <div className="w-full bg-primary/20 rounded-full h-2 overflow-hidden">
            <div
              className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{ width: `${calcProgress.percentage}%` }}
            />
          </div>
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <div className="bg-card border rounded-2xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground font-medium">Gross Earnings</p>
          <p className="text-xl font-bold text-foreground mt-1 tabular-nums">
            ₹{summary?.totals.gross || '0.00'}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">Staged active</p>
        </div>

        <div className="bg-card border rounded-2xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground font-medium">Total Deductions</p>
          <p className="text-xl font-bold text-foreground mt-1 tabular-nums">
            ₹{summary?.totals.deductions || '0.00'}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">PF, ESI, PT, TDS, Loans</p>
        </div>

        <div className="bg-card border rounded-2xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground font-medium">Net Disbursable</p>
          <p className="text-xl font-bold text-emerald-700 mt-1 tabular-nums">
            ₹{summary?.totals.net || '0.00'}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">Ready for payout</p>
        </div>

        <div className="bg-card border rounded-2xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground font-medium">Employer Cost (CTC)</p>
          <p className="text-xl font-bold text-foreground mt-1 tabular-nums">
            ₹{summary?.totals.employerCost || '0.00'}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">Includes ER PF & ESI</p>
        </div>

        <div className="bg-card border rounded-2xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground font-medium">Headcount</p>
          <p className="text-xl font-bold text-foreground mt-1">
            {summary?.includedCount || 0}
            <span className="text-xs text-muted-foreground font-normal ml-1">
              / {summary?.headcount || 0}
            </span>
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">{summary?.heldCount || 0} on hold</p>
        </div>

        <div className="bg-card border rounded-2xl p-4 shadow-sm">
          <p className="text-xs text-muted-foreground font-medium">Policy Blockers</p>
          <p
            className={`text-xl font-bold mt-1 ${
              (summary?.blockersCount || 0) > 0 ? 'text-rose-600' : 'text-emerald-700'
            }`}
          >
            {summary?.blockersCount || 0}
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            {summary?.warningsCount || 0} warnings
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b flex items-center gap-6 text-sm font-semibold">
        <button
          onClick={() => setActiveTab('staged')}
          className={`pb-3 transition relative ${
            activeTab === 'staged' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Staged Employees ({employees.length})
          {activeTab === 'staged' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('variance')}
          className={`pb-3 transition relative ${
            activeTab === 'variance' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Set-Based Variance ({variance.length})
          {activeTab === 'variance' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
          )}
        </button>

        <button
          onClick={() => setActiveTab('blockers')}
          className={`pb-3 transition relative ${
            activeTab === 'blockers' ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Warnings & Blockers ({(summary?.blockersCount || 0) + (summary?.warningsCount || 0)})
          {activeTab === 'blockers' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
          )}
        </button>
      </div>

      {/* TAB 1: Staged Employees Table */}
      {activeTab === 'staged' && (
        <div className="bg-card border rounded-2xl overflow-hidden shadow-sm space-y-4 p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground">Filter:</span>
              {(['all', 'included', 'held', 'blockers', 'warnings'] as const).map(st => (
                <button
                  key={st}
                  onClick={() => setFilterStatus(st)}
                  className={`text-xs px-3 py-1 rounded-full font-medium transition ${
                    filterStatus === st
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {st.charAt(0).toUpperCase() + st.slice(1)}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search employee..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full text-xs pl-8 pr-3 py-2 border rounded-lg bg-background text-foreground outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b bg-muted/40 text-muted-foreground">
                  <th className="p-3 font-semibold">Employee</th>
                  <th className="p-3 font-semibold text-right">Gross Pay</th>
                  <th className="p-3 font-semibold text-right">Deductions</th>
                  <th className="p-3 font-semibold text-right">Net Pay</th>
                  <th className="p-3 font-semibold text-center">Audit / Status</th>
                  <th className="p-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground">
                      No employees match the selected criteria.
                    </td>
                  </tr>
                ) : (
                  filteredEmployees.map(emp => (
                    <tr key={emp.id} className="hover:bg-muted/20 transition">
                      <td className="p-3">
                        <div className="font-semibold text-foreground">
                          {emp.firstName} {emp.lastName}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {emp.empCode} • {emp.emailWork}
                        </div>
                      </td>
                      <td className="p-3 text-right font-medium tabular-nums">
                        ₹{emp.gross}
                      </td>
                      <td className="p-3 text-right font-medium tabular-nums text-rose-700">
                        ₹{emp.deductions}
                      </td>
                      <td className="p-3 text-right font-bold tabular-nums text-emerald-700">
                        ₹{emp.net}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              emp.status === 'included'
                                ? 'bg-emerald-100 text-emerald-800'
                                : emp.status === 'held'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-rose-100 text-rose-800'
                            }`}
                          >
                            {emp.status}
                          </span>
                          {emp.blockers.length > 0 && (
                            <span className="text-[10px] text-rose-600 font-semibold flex items-center gap-0.5">
                              <ShieldAlert className="w-3 h-3" /> {emp.blockers.length} Blocker(s)
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleOpenExplain(emp.employeeId)}
                            className="px-2.5 py-1 text-[11px] font-semibold border rounded hover:bg-muted text-primary"
                          >
                            Explain
                          </button>

                          <button
                            onClick={() => handleOpenSimulate(emp)}
                            className="px-2.5 py-1 text-[11px] font-semibold border rounded hover:bg-muted"
                          >
                            Simulate
                          </button>

                          {emp.status === 'held' ? (
                            <button
                              onClick={() => handleRelease(emp.employeeId)}
                              className="px-2.5 py-1 text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded hover:bg-emerald-100"
                            >
                              Release
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                setHoldTargetEmpId(emp.employeeId);
                                setHoldReasonText('');
                                setHoldModalOpen(true);
                              }}
                              className="px-2.5 py-1 text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 rounded hover:bg-amber-100"
                            >
                              Hold
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: Set-Based Variance Table */}
      {activeTab === 'variance' && (
        <div className="bg-card border rounded-2xl overflow-hidden shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Set-Based Variance Comparison
              </h2>
              <p className="text-xs text-muted-foreground">
                Current staged run compared against prior period ({priorPeriod || 'First Run'}).
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b bg-muted/40 text-muted-foreground">
                  <th className="p-3 font-semibold">Employee</th>
                  <th className="p-3 font-semibold text-center">Category</th>
                  <th className="p-3 font-semibold text-right">Prior Gross</th>
                  <th className="p-3 font-semibold text-right">Current Gross</th>
                  <th className="p-3 font-semibold text-right">Gross Variance</th>
                  <th className="p-3 font-semibold text-right">% Change</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {variance.map(v => (
                  <tr key={v.employeeId} className="hover:bg-muted/20 transition">
                    <td className="p-3 font-medium">
                      {v.firstName} {v.lastName} ({v.empCode})
                    </td>
                    <td className="p-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          v.varianceCategory === 'NEW_JOINER'
                            ? 'bg-blue-100 text-blue-800'
                            : v.varianceCategory === 'VARIANCE'
                            ? 'bg-amber-100 text-amber-800'
                            : v.varianceCategory === 'LEAVER_OR_EXCLUDED'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {v.varianceCategory}
                      </span>
                    </td>
                    <td className="p-3 text-right tabular-nums text-muted-foreground">
                      ₹{v.priorGross}
                    </td>
                    <td className="p-3 text-right tabular-nums font-semibold">
                      ₹{v.currentGross}
                    </td>
                    <td
                      className={`p-3 text-right tabular-nums font-semibold ${
                        parseFloat(v.grossDiff) > 0
                          ? 'text-emerald-700'
                          : parseFloat(v.grossDiff) < 0
                          ? 'text-rose-700'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {parseFloat(v.grossDiff) > 0 ? '+' : ''}₹{v.grossDiff}
                    </td>
                    <td className="p-3 text-right tabular-nums font-bold">
                      {v.grossPctChange}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: Warnings & Blockers Engine */}
      {activeTab === 'blockers' && (
        <div className="bg-card border rounded-2xl overflow-hidden shadow-sm p-6 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">
            Compliance Policy Exceptions & Hard Blockers
          </h2>
          <div className="space-y-3">
            {employees.filter(e => e.blockers.length > 0 || e.warnings.length > 0).length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                <p>Clean run! Zero policy blockers or compliance warnings detected.</p>
              </div>
            ) : (
              employees
                .filter(e => e.blockers.length > 0 || e.warnings.length > 0)
                .map(e => (
                  <div key={e.id} className="p-4 border rounded-xl space-y-2 bg-background">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-foreground">
                        {e.firstName} {e.lastName} ({e.empCode})
                      </span>
                      <span className="text-[10px] text-muted-foreground">{e.status}</span>
                    </div>

                    {e.blockers.map((b, i) => (
                      <div
                        key={i}
                        className="text-xs p-2 bg-rose-50 text-rose-800 rounded-lg flex items-center gap-2"
                      >
                        <XCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
                        <span>{b}</span>
                      </div>
                    ))}

                    {e.warnings.map((w, i) => (
                      <div
                        key={i}
                        className="text-xs p-2 bg-amber-50 text-amber-800 rounded-lg flex items-center gap-2"
                      >
                        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                        <span>{w}</span>
                      </div>
                    ))}
                  </div>
                ))
            )}
          </div>
        </div>
      )}

      {/* SLIDEOVER: Explain-This-Payslip Panel */}
      {explainModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex justify-end">
          <div className="bg-card border-l max-w-xl w-full h-full shadow-2xl flex flex-col overflow-y-auto p-6 space-y-6">
            <div className="flex items-center justify-between border-b pb-4">
              <div>
                <h2 className="text-base font-bold text-foreground">
                  Explain-This-Payslip Trace
                </h2>
                <p className="text-xs text-muted-foreground">
                  Step-by-step derivation: Net → Lines → Formulas → Attendance
                </p>
              </div>
              <button
                onClick={() => setExplainModalOpen(false)}
                className="p-1 rounded-lg hover:bg-muted text-muted-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {explainLoading || !explainData ? (
              <div className="p-12 text-center text-xs text-muted-foreground">
                <RefreshCw className="w-6 h-6 animate-spin text-primary mx-auto mb-2" />
                Tracing derivation rules...
              </div>
            ) : (
              <div className="space-y-6 text-xs">
                {/* Employee Card */}
                <div className="p-3 bg-muted rounded-xl flex justify-between items-center">
                  <div>
                    <p className="font-semibold text-foreground text-sm">
                      {explainData.employee.name}
                    </p>
                    <p className="text-muted-foreground">
                      {explainData.employee.empCode} • {explainData.employee.email}
                    </p>
                  </div>
                  <span className="px-2 py-0.5 bg-primary/10 text-primary font-bold rounded-full">
                    {explainData.employee.status}
                  </span>
                </div>

                {/* Net Pay Derivation Card */}
                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-emerald-950">Disbursable Net Pay</span>
                    <span className="text-lg font-bold text-emerald-800 tabular-nums">
                      ₹{explainData.summary.net}
                    </span>
                  </div>
                  <div className="text-[11px] text-emerald-900 border-t border-emerald-200/60 pt-2 flex justify-between">
                    <span>Gross (₹{explainData.summary.gross})</span>
                    <span>- Deductions (₹{explainData.summary.deductions})</span>
                    <span>= Net Pay</span>
                  </div>
                </div>

                {/* Attendance Factors */}
                <div className="p-3 border rounded-xl space-y-1.5">
                  <p className="font-semibold text-foreground">Attendance & Payable Days</p>
                  <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                    <div>
                      Payable Days: <strong className="text-foreground">{explainData.summary.payableDays}</strong>
                    </div>
                    <div>
                      Proration Ratio: <strong className="text-foreground">{explainData.summary.payableRatio}</strong>
                    </div>
                  </div>
                </div>

                {/* Earnings Breakdown */}
                <div className="space-y-2">
                  <p className="font-semibold text-foreground">Earnings Breakdown</p>
                  <div className="border rounded-xl divide-y overflow-hidden">
                    {explainData.lines.earnings.map(l => (
                      <div key={l.code} className="p-2.5 flex justify-between items-center">
                        <div>
                          <p className="font-medium text-foreground">{l.name} ({l.code})</p>
                          {l.ruleRef && (
                            <p className="text-[10px] text-muted-foreground">Formula: {l.ruleRef}</p>
                          )}
                        </div>
                        <span className="font-semibold tabular-nums text-foreground">
                          ₹{l.amount}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Deductions Breakdown */}
                <div className="space-y-2">
                  <p className="font-semibold text-foreground">Deductions Breakdown</p>
                  <div className="border rounded-xl divide-y overflow-hidden">
                    {explainData.lines.deductions.map(l => (
                      <div key={l.code} className="p-2.5 flex justify-between items-center">
                        <div>
                          <p className="font-medium text-foreground">{l.name} ({l.code})</p>
                          {l.ruleRef && (
                            <p className="text-[10px] text-muted-foreground">Rule: {l.ruleRef}</p>
                          )}
                        </div>
                        <span className="font-semibold tabular-nums text-rose-700">
                          -₹{l.amount}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Integrity & Verifiable Hash */}
                <div className="p-3 bg-muted rounded-xl space-y-1">
                  <p className="font-semibold text-foreground">Verifiable Input Hash</p>
                  <code className="text-[10px] block break-all text-muted-foreground bg-background p-1.5 rounded">
                    {explainData.inputHash || 'Pending calculation'}
                  </code>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: Simulate Payslip */}
      {simulateModalOpen && simulateEmp && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-foreground">
                Simulate Payslip Adjustments
              </h3>
              <button
                onClick={() => setSimulateModalOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-muted-foreground">
              Preview pure calculation outcomes for {simulateEmp.firstName} {simulateEmp.lastName} without mutating payroll data.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-semibold block mb-1">Paid Days</label>
                <input
                  type="number"
                  value={simPaidDays}
                  onChange={e => setSimPaidDays(Number(e.target.value))}
                  className="w-full border rounded-lg p-2 bg-background"
                />
              </div>

              <div>
                <label className="font-semibold block mb-1">LOP (Loss of Pay) Days</label>
                <input
                  type="number"
                  value={simLopDays}
                  onChange={e => setSimLopDays(Number(e.target.value))}
                  className="w-full border rounded-lg p-2 bg-background"
                />
              </div>

              <div className="col-span-2">
                <label className="font-semibold block mb-1">Ad-hoc Bonus / Incentive (₹)</label>
                <input
                  type="number"
                  value={simBonusAmount}
                  onChange={e => setSimBonusAmount(Number(e.target.value))}
                  className="w-full border rounded-lg p-2 bg-background"
                />
              </div>
            </div>

            <button
              onClick={handleRunSimulation}
              disabled={simulating}
              className="w-full py-2 bg-primary text-primary-foreground font-semibold rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {simulating ? 'Calculating Preview...' : 'Run Simulation Preview'}
            </button>

            {simResult && (
              <div className="p-3 bg-muted rounded-xl space-y-2 border">
                <p className="font-bold text-foreground">Simulated Output</p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <p className="text-muted-foreground">Simulated Gross</p>
                    <p className="font-bold tabular-nums">₹{simResult.gross}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Deductions</p>
                    <p className="font-bold tabular-nums text-rose-700">₹{simResult.deductions}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Net Pay</p>
                    <p className="font-bold tabular-nums text-emerald-700">₹{simResult.net}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: Place Employee On Hold */}
      {holdModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 text-xs">
            <h3 className="text-base font-bold text-foreground">Place Employee On Hold</h3>
            <p className="text-muted-foreground">
              Employees on hold are excluded from bank disbursement and financial locking until released.
            </p>

            <div>
              <label className="font-semibold block mb-1">Reason for Hold</label>
              <textarea
                rows={3}
                placeholder="e.g. Pending bank account verification / Disputed overtime"
                value={holdReasonText}
                onChange={e => setHoldReasonText(e.target.value)}
                className="w-full border rounded-lg p-2 bg-background outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setHoldModalOpen(false)}
                className="px-4 py-2 border rounded-lg hover:bg-muted font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleHoldConfirm}
                disabled={!holdReasonText.trim()}
                className="px-4 py-2 bg-amber-600 text-white font-semibold rounded-lg hover:bg-amber-700 disabled:opacity-50"
              >
                Confirm Hold
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
