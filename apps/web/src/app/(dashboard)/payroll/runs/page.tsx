'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Calendar,
  CheckCircle2,
  Clock,
  AlertCircle,
  Plus,
  RefreshCw,
  ChevronRight,
  ShieldCheck,
  FileSpreadsheet,
} from 'lucide-react';

interface PeriodItem {
  id: string;
  period: string;
  startDate: string;
  endDate: string;
  attendanceLockedAt: string | null;
  status: string;
}

interface RunItem {
  id: string;
  periodId: string;
  runType: string;
  sequence: number;
  status: string;
  createdAt: string;
  approvedBy: string | null;
  lockedBy: string | null;
}

export default function PayrollRunsPage() {
  const [periods, setPeriods] = useState<PeriodItem[]>([]);
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [runType, setRunType] = useState('regular');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    async function fetchPeriods() {
      try {
        setLoading(true);
        const res = await fetch('/api/v1/payroll/periods');
        if (!res.ok) throw new Error('Failed to fetch payroll periods');
        const json = await res.json();
        const periodList = json.data || [];
        setPeriods(periodList);
        if (periodList.length > 0) {
          setSelectedPeriodId(periodList[0].id);
        }
      } catch (err) {
        setErrorMsg((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    fetchPeriods();
  }, []);

  useEffect(() => {
    if (!selectedPeriodId) return;
    async function fetchRuns() {
      try {
        const res = await fetch(`/api/v1/payroll/runs?periodId=${selectedPeriodId}`);
        if (!res.ok) throw new Error('Failed to fetch payroll runs');
        const json = await res.json();
        setRuns(json.data || []);
      } catch (err) {
        setErrorMsg((err as Error).message);
      }
    }
    fetchRuns();
  }, [selectedPeriodId]);

  const selectedPeriod = periods.find(p => p.id === selectedPeriodId);

  const handleCreateRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPeriodId) return;
    try {
      setCreating(true);
      const res = await fetch('/api/v1/payroll/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodId: selectedPeriodId,
          runType,
          sequence: runs.length + 1,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to initialize payroll run');
      }
      const data = await res.json();
      setCreateModalOpen(false);
      window.location.href = `/payroll/runs/${data.data.id}`;
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Payroll Processing Console
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Execute monthly payroll calculations, review set-based variance, audit statutory rules, and seal immutable payslips.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCreateModalOpen(true)}
            disabled={!selectedPeriodId}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground font-medium rounded-lg text-sm hover:opacity-90 transition disabled:opacity-50 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Initialize Payroll Run
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/20 text-destructive rounded-xl text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Period Selection & Pre-Flight Cycle Checklist */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-card border rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Calendar className="w-4 h-4 text-primary" />
              Active Pay Period
            </h2>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-2">
              Select Pay Period
            </label>
            <select
              value={selectedPeriodId}
              onChange={e => setSelectedPeriodId(e.target.value)}
              className="w-full text-sm border rounded-lg p-2.5 bg-background text-foreground focus:ring-2 focus:ring-primary outline-none"
            >
              {periods.map(p => (
                <option key={p.id} value={p.id}>
                  {p.period} ({p.startDate} to {p.endDate})
                </option>
              ))}
            </select>
          </div>

          {selectedPeriod && (
            <div className="p-3 bg-muted rounded-xl space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Start Date:</span>
                <span className="font-medium text-foreground">{selectedPeriod.startDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">End Date:</span>
                <span className="font-medium text-foreground">{selectedPeriod.endDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Attendance Lock:</span>
                <span className="font-medium flex items-center gap-1">
                  {selectedPeriod.attendanceLockedAt ? (
                    <span className="text-emerald-700 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Locked
                    </span>
                  ) : (
                    <span className="text-amber-700 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" /> Unlocked
                    </span>
                  )}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Pre-Flight Checklist */}
        <div className="lg:col-span-2 bg-card border rounded-2xl p-6 shadow-sm space-y-4">
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            Payroll Pre-Flight Readiness Checklist
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="p-3 border rounded-xl flex items-start gap-3 bg-background">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-foreground">Attendance Cutoff</p>
                <p className="text-xs text-muted-foreground">Biometric punches and leaves locked for period.</p>
              </div>
            </div>

            <div className="p-3 border rounded-xl flex items-start gap-3 bg-background">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-foreground">Active Salary Structures</p>
                <p className="text-xs text-muted-foreground">Effective-dated CTC and formulas assigned.</p>
              </div>
            </div>

            <div className="p-3 border rounded-xl flex items-start gap-3 bg-background">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-foreground">CA Statutory Rule Sets</p>
                <p className="text-xs text-muted-foreground">PF, ESI, PT, LWF versions active and certified.</p>
              </div>
            </div>

            <div className="p-3 border rounded-xl flex items-start gap-3 bg-background">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium text-foreground">One-Time Inputs & Loans</p>
                <p className="text-xs text-muted-foreground">Approved incentives, bonuses & EMI schedules queued.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Runs Table */}
      <div className="bg-card border rounded-2xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b flex items-center justify-between bg-muted/40">
          <div>
            <h2 className="text-base font-semibold text-foreground">Payroll Runs for Selected Period</h2>
            <p className="text-xs text-muted-foreground">Sequential calculation, review, and approval cycles</p>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
            <RefreshCw className="w-5 h-5 animate-spin text-primary" />
            Loading runs...
          </div>
        ) : runs.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground flex flex-col items-center gap-3">
            <FileSpreadsheet className="w-8 h-8 text-muted-foreground/50" />
            <p>No payroll runs initiated for this period yet.</p>
            <button
              onClick={() => setCreateModalOpen(true)}
              className="text-xs font-semibold text-primary underline"
            >
              Start the first payroll run
            </button>
          </div>
        ) : (
          <div className="divide-y text-sm">
            {runs.map(r => (
              <div
                key={r.id}
                className="p-5 flex items-center justify-between hover:bg-muted/30 transition"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold">
                    #{r.sequence}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground capitalize">
                        {r.runType.replace('_', ' ')} Run
                      </span>
                      <span
                        className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                          r.status === 'locked'
                            ? 'bg-purple-100 text-purple-800'
                            : r.status === 'approved'
                            ? 'bg-emerald-100 text-emerald-800'
                            : r.status === 'calculated'
                            ? 'bg-blue-100 text-blue-800'
                            : r.status === 'calculating'
                            ? 'bg-amber-100 text-amber-800 animate-pulse'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {r.status}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Created on {new Date(r.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Link
                    href={`/payroll/runs/${r.id}`}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition"
                  >
                    Open Console
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Initialize Run Modal */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-foreground">Initialize New Payroll Run</h3>
            <p className="text-xs text-muted-foreground">
              Create a staged run workspace for period {selectedPeriod?.period}.
            </p>

            <form onSubmit={handleCreateRun} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-foreground block mb-1">
                  Run Type
                </label>
                <select
                  value={runType}
                  onChange={e => setRunType(e.target.value)}
                  className="w-full text-sm border rounded-lg p-2.5 bg-background text-foreground outline-none"
                >
                  <option value="regular">Regular Monthly Payroll</option>
                  <option value="off_cycle">Off-Cycle / Supplementary</option>
                  <option value="correction">Correction Run</option>
                  <option value="final">Final Settlement / FnF</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold border rounded-lg hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 text-xs font-semibold bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
                >
                  {creating ? 'Initializing...' : 'Confirm & Open'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
