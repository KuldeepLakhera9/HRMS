'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Lock,
  Unlock,
  ShieldAlert,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Plus,
} from 'lucide-react';

interface PeriodLock {
  id: string;
  periodStart: string;
  periodEnd: string;
  isLocked: boolean;
  lockedBy: string | null;
  lockedAt: string | null;
  unlockedBy: string | null;
  unlockedAt: string | null;
  reason: string;
  createdAt: string;
}

interface RecalculateResult {
  day: {
    id: string;
    employeeId: string;
    workDate: string;
    status: string;
    totalWorkMinutes: number;
    effectiveMinutes: number;
    lateInMinutes: number;
    earlyOutMinutes: number;
    overtimeMinutes: number;
    payableDay: string;
    sourceHash: string;
  };
  recomputed: boolean;
  sourceHash: string;
}

export default function PeriodLocksPage() {
  const [locks, setLocks] = useState<PeriodLock[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  // Lock Modal State
  const [isLockModalOpen, setIsLockModalOpen] = useState(false);
  const [lockStart, setLockStart] = useState('');
  const [lockEnd, setLockEnd] = useState('');
  const [lockReason, setLockReason] = useState('');
  const [isLocking, setIsLocking] = useState(false);

  // Unlock Modal State
  const [isUnlockModalOpen, setIsUnlockModalOpen] = useState(false);
  const [unlockTarget, setUnlockTarget] = useState<PeriodLock | null>(null);
  const [unlockReason, setUnlockReason] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);

  // Recalculate Modal State
  const [isRecalcModalOpen, setIsRecalcModalOpen] = useState(false);
  const [recalcEmpId, setRecalcEmpId] = useState('');
  const [recalcDate, setRecalcDate] = useState('');
  const [isRecalculating, setIsRecalculating] = useState(false);
  const [recalcResult, setRecalcResult] = useState<RecalculateResult | null>(null);

  const fetchLocks = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/v1/attendance/locks');
      if (res.ok) {
        const json = await res.json();
        setLocks(json.data || []);
      }
    } catch (err) {
      console.error('Failed to load period locks:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLocks();
  }, [fetchLocks]);

  // Handle Lock Period
  const handleLockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lockStart || !lockEnd || !lockReason.trim()) {
      setErrorToast('Please specify period start, end, and a mandatory audit reason.');
      return;
    }
    setIsLocking(true);
    try {
      const res = await fetch('/api/v1/attendance/locks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodStart: lockStart,
          periodEnd: lockEnd,
          reason: lockReason.trim(),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to lock attendance period.');
      }

      setSuccessToast(`Period ${lockStart} to ${lockEnd} successfully locked.`);
      setIsLockModalOpen(false);
      setLockReason('');
      fetchLocks();
    } catch (err: unknown) {
      setErrorToast(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLocking(false);
    }
  };

  // Handle Unlock Period
  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unlockTarget || !unlockReason.trim()) {
      setErrorToast('A mandatory audit reason is required to unlock a period.');
      return;
    }
    setIsUnlocking(true);
    try {
      const res = await fetch('/api/v1/attendance/locks/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periodStart: unlockTarget.periodStart,
          periodEnd: unlockTarget.periodEnd,
          reason: unlockReason.trim(),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to unlock attendance period.');
      }

      setSuccessToast(`Period ${unlockTarget.periodStart} to ${unlockTarget.periodEnd} unlocked.`);
      setIsUnlockModalOpen(false);
      setUnlockTarget(null);
      setUnlockReason('');
      fetchLocks();
    } catch (err: unknown) {
      setErrorToast(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsUnlocking(false);
    }
  };

  // Handle Recalculate Day
  const handleRecalculateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recalcEmpId || !recalcDate) {
      setErrorToast('Please enter an employee ID and work date.');
      return;
    }
    setIsRecalculating(true);
    setRecalcResult(null);
    try {
      const res = await fetch('/api/v1/attendance/days/recalculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: recalcEmpId,
          workDate: recalcDate,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to recalculate attendance day.');
      }

      const json = await res.json();
      setRecalcResult(json.data);
      setSuccessToast(
        json.data.recomputed
          ? 'Attendance day recomputed successfully!'
          : 'Attendance day was up-to-date (idempotent skip).',
      );
    } catch (err: unknown) {
      setErrorToast(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsRecalculating(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <Lock className="w-6 h-6 text-indigo-600" />
            <h1 className="text-2xl font-bold text-gray-900">Period Locks & Day Recalculation</h1>
            <span className="bg-indigo-100 text-indigo-700 text-xs px-2.5 py-0.5 rounded-full font-medium">Sprint 2.3</span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Freeze attendance periods for payroll processing, enforce immutability, and trigger pure-engine day recomputations.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsRecalcModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-lg text-sm font-medium transition-colors"
          >
            <RotateCcw className="w-4 h-4 text-gray-500" />
            Recalculate Day
          </button>

          <button
            onClick={() => setIsLockModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg text-sm font-medium shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            Lock Period
          </button>
        </div>
      </div>

      {/* Feedback Toasts */}
      {successToast && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between text-emerald-800">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <span className="text-sm font-medium">{successToast}</span>
          </div>
          <button onClick={() => setSuccessToast(null)} className="text-sm text-emerald-600 hover:underline">Dismiss</button>
        </div>
      )}

      {errorToast && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg flex items-center justify-between text-rose-800">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-rose-600" />
            <span className="text-sm font-medium">{errorToast}</span>
          </div>
          <button onClick={() => setErrorToast(null)} className="text-sm text-rose-600 hover:underline">Dismiss</button>
        </div>
      )}

      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-rose-50 rounded-lg text-rose-600">
            <Lock className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900">
              {locks.filter(l => l.isLocked).length}
            </div>
            <div className="text-xs text-gray-500">Active Locked Periods</div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-emerald-50 rounded-lg text-emerald-600">
            <Unlock className="w-6 h-6" />
          </div>
          <div>
            <div className="text-2xl font-bold text-gray-900">
              {locks.filter(l => !l.isLocked).length}
            </div>
            <div className="text-xs text-gray-500">Unlocked Periods</div>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
          <div className="p-3 bg-blue-50 rounded-lg text-blue-600">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <div className="text-sm font-bold text-gray-900">Payroll Immutability</div>
            <div className="text-xs text-gray-500">Locked periods reject updates</div>
          </div>
        </div>
      </div>

      {/* Period Locks Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-gray-200 flex justify-between items-center">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Payroll Period Locks</h2>
          <span className="text-xs text-gray-500">Total: {locks.length} records</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase">
                <th className="py-3 px-4">Period Range</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Reason / Notes</th>
                <th className="py-3 px-4">Locked Date</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-gray-400">
                    Loading attendance period locks...
                  </td>
                </tr>
              ) : locks.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-gray-400">
                    No period locks created yet.
                  </td>
                </tr>
              ) : (
                locks.map(l => (
                  <tr key={l.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="py-3 px-4 font-semibold text-gray-900">
                      {l.periodStart} &rarr; {l.periodEnd}
                    </td>
                    <td className="py-3 px-4">
                      {l.isLocked ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
                          <Lock className="w-3 h-3" /> Locked
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <Unlock className="w-3 h-3" /> Unlocked
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-gray-600 max-w-xs truncate" title={l.reason}>
                      {l.reason}
                    </td>
                    <td className="py-3 px-4 text-xs text-gray-400">
                      {l.lockedAt ? new Date(l.lockedAt).toLocaleString() : '--'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {l.isLocked && (
                        <button
                          onClick={() => {
                            setUnlockTarget(l);
                            setIsUnlockModalOpen(true);
                          }}
                          className="px-3 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-medium rounded border border-amber-200 transition-colors"
                        >
                          Unlock
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Lock Period Modal */}
      {isLockModalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-indigo-600" />
              <h3 className="text-lg font-bold text-gray-900">Lock Attendance Period</h3>
            </div>
            <p className="text-xs text-gray-500">
              Locking an attendance period freezes all employee attendance days within this date range, preventing automatic recalculation or modifications during payroll run.
            </p>

            <form onSubmit={handleLockSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Start Date</label>
                <input
                  type="date"
                  value={lockStart}
                  onChange={e => setLockStart(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">End Date</label>
                <input
                  type="date"
                  value={lockEnd}
                  onChange={e => setLockEnd(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Audit Reason (Mandatory)</label>
                <textarea
                  value={lockReason}
                  onChange={e => setLockReason(e.target.value)}
                  required
                  placeholder="e.g. Monthly payroll closure for March 2026."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsLockModalOpen(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLocking}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {isLocking ? 'Locking...' : 'Confirm Lock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Unlock Period Modal */}
      {isUnlockModalOpen && unlockTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-2">
              <Unlock className="w-5 h-5 text-amber-600" />
              <h3 className="text-lg font-bold text-gray-900">Unlock Attendance Period</h3>
            </div>
            <p className="text-xs text-amber-700 bg-amber-50 p-3 rounded-lg border border-amber-200">
              Warning: Unlocking period {unlockTarget.periodStart} to {unlockTarget.periodEnd} will allow retroactive attendance changes. An immutable audit record will be logged.
            </p>

            <form onSubmit={handleUnlockSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Reason for Unlocking (Mandatory)</label>
                <textarea
                  value={unlockReason}
                  onChange={e => setUnlockReason(e.target.value)}
                  required
                  placeholder="e.g. Approved adjustment for employee leave regularization."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsUnlockModalOpen(false);
                    setUnlockTarget(null);
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUnlocking}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {isUnlocking ? 'Unlocking...' : 'Confirm Unlock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Recalculate Day Modal */}
      {isRecalcModalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-blue-600" />
              <h3 className="text-lg font-bold text-gray-900">Recalculate Attendance Day</h3>
            </div>
            <p className="text-xs text-gray-500">
              Executes the deterministic pure-engine day calculation for an employee and work date. Skips database writes if the input source hash is unchanged.
            </p>

            <form onSubmit={handleRecalculateSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Employee UUID</label>
                <input
                  type="text"
                  value={recalcEmpId}
                  onChange={e => setRecalcEmpId(e.target.value)}
                  required
                  placeholder="e.g. 018e38f9-b88d-78c6-a675-9b2f6ef13928"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Work Date</label>
                <input
                  type="date"
                  value={recalcDate}
                  onChange={e => setRecalcDate(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {recalcResult && (
                <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 text-xs space-y-2">
                  <div className="flex justify-between font-semibold">
                    <span>Status: <span className="uppercase text-blue-600">{recalcResult.day.status}</span></span>
                    <span>Payable Day: {recalcResult.day.payableDay}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-gray-600">
                    <div>Work Minutes: {recalcResult.day.totalWorkMinutes}</div>
                    <div>Effective Minutes: {recalcResult.day.effectiveMinutes}</div>
                    <div>Late In: {recalcResult.day.lateInMinutes}m</div>
                    <div>Early Out: {recalcResult.day.earlyOutMinutes}m</div>
                  </div>
                  <div className="text-[10px] text-gray-400 font-mono truncate">
                    Hash: {recalcResult.sourceHash}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsRecalcModalOpen(false);
                    setRecalcResult(null);
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isRecalculating}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {isRecalculating ? 'Recalculating...' : 'Recalculate Now'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
