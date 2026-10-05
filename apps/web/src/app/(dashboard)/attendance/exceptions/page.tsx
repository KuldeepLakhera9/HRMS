'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  Filter,
  RefreshCw,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';

interface ExceptionItem {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  departmentName: string | null;
  workDate: string;
  shiftName: string | null;
  shiftStartTime: string | null;
  shiftEndTime: string | null;
  firstIn: string | null;
  lastOut: string | null;
  punchCount: number;
  totalWorkMinutes: number;
  effectiveMinutes: number;
  lateInMinutes: number;
  earlyOutMinutes: number;
  overtimeMinutes: number;
  status: string;
  isRegularized: boolean;
  isLocked: boolean;
}

interface SummaryCounts {
  totalExceptions: number;
  missingPunch: number;
  lateIn: number;
  earlyOut: number;
  shortHours: number;
  unexcusedAbsence: number;
}

export default function ExceptionsInboxPage() {
  const [exceptions, setExceptions] = useState<ExceptionItem[]>([]);
  const [summary, setSummary] = useState<SummaryCounts>({
    totalExceptions: 0,
    missingPunch: 0,
    lateIn: 0,
    earlyOut: 0,
    shortHours: 0,
    unexcusedAbsence: 0,
  });
  const [nextCursor, setNextCursor] = useState<{ workDate: string; id: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Filter States
  const [exceptionType, setExceptionType] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [onlyUnresolved, setOnlyUnresolved] = useState(true);

  // Bulk Action State
  const [bulkAction, setBulkAction] = useState<'mark_present' | 'excuse' | 'regularize' | null>(null);
  const [bulkComments, setBulkComments] = useState('');
  const [isSubmittingBulk, setIsSubmittingBulk] = useState(false);

  // Toasts
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  const fetchExceptions = useCallback(
    async (isCursorNext = false) => {
      try {
        if (!isCursorNext) {
          setIsLoading(true);
        } else {
          setIsLoadingMore(true);
        }

        const params = new URLSearchParams();
        if (exceptionType !== 'all') params.set('exceptionType', exceptionType);
        if (startDate) params.set('startDate', startDate);
        if (endDate) params.set('endDate', endDate);
        if (onlyUnresolved) params.set('isRegularized', 'false');

        if (isCursorNext && nextCursor) {
          params.set('cursorWorkDate', nextCursor.workDate);
          params.set('cursorId', nextCursor.id);
        }

        params.set('limit', '30');

        const res = await fetch(`/api/v1/attendance/exceptions?${params.toString()}`);
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error?.message || 'Failed to load exceptions.');
        }

        const json = await res.json();
        const data = json.data;

        if (isCursorNext) {
          setExceptions(prev => [...prev, ...(data.items || [])]);
        } else {
          setExceptions(data.items || []);
          if (data.summary) {
            setSummary(data.summary);
          }
        }

        setNextCursor(data.nextCursor || null);
      } catch (err: unknown) {
        setErrorToast(err instanceof Error ? err.message : 'Error fetching attendance exceptions.');
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [exceptionType, startDate, endDate, onlyUnresolved, nextCursor],
  );

  useEffect(() => {
    fetchExceptions(false);
  }, [exceptionType, startDate, endDate, onlyUnresolved]);

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedIds(new Set(exceptions.map(x => x.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectRow = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleExecuteBulkResolve = async () => {
    if (!bulkAction || selectedIds.size === 0) return;

    try {
      setIsSubmittingBulk(true);
      setErrorToast(null);

      const res = await fetch('/api/v1/attendance/exceptions/bulk-resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dayIds: Array.from(selectedIds),
          action: bulkAction,
          comments: bulkComments || undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || 'Bulk resolution failed.');
      }

      setSuccessToast(json.data.message || 'Exceptions successfully resolved.');
      setSelectedIds(new Set());
      setBulkAction(null);
      setBulkComments('');
      fetchExceptions(false);
    } catch (err: unknown) {
      setErrorToast(err instanceof Error ? err.message : 'Failed to execute bulk resolution.');
    } finally {
      setIsSubmittingBulk(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-amber-600" />
            Attendance Exceptions Inbox
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Review missing punches, delayed check-ins, early leaves, and perform bulk administrative resolutions.
          </p>
        </div>
        <button
          onClick={() => fetchExceptions(false)}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Toasts */}
      {successToast && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <span>{successToast}</span>
          </div>
          <button onClick={() => setSuccessToast(null)} className="text-emerald-600 hover:text-emerald-900 text-xs font-semibold">
            Dismiss
          </button>
        </div>
      )}

      {errorToast && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-rose-600" />
            <span>{errorToast}</span>
          </div>
          <button onClick={() => setErrorToast(null)} className="text-rose-600 hover:text-rose-900 text-xs font-semibold">
            Dismiss
          </button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-amber-50/60 border border-amber-200/80 rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">Total Unresolved</p>
          <p className="text-2xl font-bold text-amber-900 mt-1">{summary.totalExceptions}</p>
        </div>
        <div className="bg-rose-50/60 border border-rose-200/80 rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-rose-700">Missing Punches</p>
          <p className="text-2xl font-bold text-rose-900 mt-1">{summary.missingPunch}</p>
        </div>
        <div className="bg-orange-50/60 border border-orange-200/80 rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-orange-700">Late Check-Ins</p>
          <p className="text-2xl font-bold text-orange-900 mt-1">{summary.lateIn}</p>
        </div>
        <div className="bg-purple-50/60 border border-purple-200/80 rounded-xl p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-purple-700">Early Leaves</p>
          <p className="text-2xl font-bold text-purple-900 mt-1">{summary.earlyOut}</p>
        </div>
        <div className="bg-blue-50/60 border border-blue-200/80 rounded-xl p-4 col-span-2 md:col-span-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Short Hours</p>
          <p className="text-2xl font-bold text-blue-900 mt-1">{summary.shortHours}</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white border rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-slate-500 font-medium">
            <Filter className="h-4 w-4" />
            Filters:
          </div>
          <select
            value={exceptionType}
            onChange={e => setExceptionType(e.target.value)}
            className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            <option value="all">All Exceptions</option>
            <option value="missing_punch">Missing Punch Only</option>
            <option value="late_in">Late Check-In Only</option>
            <option value="early_out">Early Out Only</option>
            <option value="short_hours">Short Hours Only</option>
            <option value="unexcused_absence">Unexcused Absence</option>
          </select>

          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            placeholder="From Date"
            className="text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 bg-slate-50 text-slate-700"
          />
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            placeholder="To Date"
            className="text-sm border border-slate-300 rounded-lg px-2.5 py-1.5 bg-slate-50 text-slate-700"
          />

          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer ml-2">
            <input
              type="checkbox"
              checked={onlyUnresolved}
              onChange={e => setOnlyUnresolved(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
            />
            Unresolved only
          </label>
        </div>
      </div>

      {/* Floating Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="bg-slate-900 text-white rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 shadow-xl border border-slate-700">
          <div className="flex items-center gap-3">
            <span className="bg-amber-500 text-slate-950 text-xs font-bold px-2.5 py-1 rounded-full">
              {selectedIds.size} Selected
            </span>
            <span className="text-sm text-slate-300">Choose resolution action for selected records:</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Admin remarks / justification..."
              value={bulkComments}
              onChange={e => setBulkComments(e.target.value)}
              className="text-xs bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
            />
            <button
              onClick={() => {
                setBulkAction('mark_present');
                handleExecuteBulkResolve();
              }}
              disabled={isSubmittingBulk}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50"
            >
              Mark Present
            </button>
            <button
              onClick={() => {
                setBulkAction('excuse');
                handleExecuteBulkResolve();
              }}
              disabled={isSubmittingBulk}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50"
            >
              Excuse Exception
            </button>
            <button
              onClick={() => {
                setBulkAction('regularize');
                handleExecuteBulkResolve();
              }}
              disabled={isSubmittingBulk}
              className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg transition disabled:opacity-50"
            >
              Recompute Day
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-2 py-1.5 text-xs text-slate-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b text-slate-600 text-xs font-semibold uppercase tracking-wider">
                <th className="p-4 w-10">
                  <input
                    type="checkbox"
                    checked={exceptions.length > 0 && selectedIds.size === exceptions.length}
                    onChange={handleSelectAll}
                    className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                  />
                </th>
                <th className="p-4">Employee</th>
                <th className="p-4">Department</th>
                <th className="p-4">Date</th>
                <th className="p-4">Shift & Timings</th>
                <th className="p-4">Work / Effective</th>
                <th className="p-4">Exception Type</th>
                <th className="p-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-slate-400" />
                    Loading exceptions...
                  </td>
                </tr>
              ) : exceptions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400">
                    <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                    No attendance exceptions matching your filter criteria.
                  </td>
                </tr>
              ) : (
                exceptions.map(item => {
                  const isChecked = selectedIds.has(item.id);
                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-slate-50/70 transition ${isChecked ? 'bg-amber-50/40' : ''}`}
                    >
                      <td className="p-4">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleSelectRow(item.id)}
                          className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                        />
                      </td>
                      <td className="p-4">
                        <div className="font-medium text-slate-900">{item.employeeName}</div>
                        <div className="text-xs text-slate-500">{item.employeeCode}</div>
                      </td>
                      <td className="p-4 text-slate-600 text-xs">{item.departmentName || '—'}</td>
                      <td className="p-4 font-mono text-xs text-slate-700">{item.workDate}</td>
                      <td className="p-4">
                        <div className="text-xs font-medium text-slate-800">{item.shiftName || 'Standard'}</div>
                        <div className="text-[11px] text-slate-500">
                          {item.shiftStartTime ? `${item.shiftStartTime.slice(0, 5)} - ${item.shiftEndTime?.slice(0, 5)}` : 'Flexible'}
                        </div>
                      </td>
                      <td className="p-4 font-mono text-xs">
                        <div>{(item.totalWorkMinutes / 60).toFixed(1)}h actual</div>
                        <div className="text-slate-500">{(item.effectiveMinutes / 60).toFixed(1)}h eff</div>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-wrap gap-1">
                          {item.status === 'missing_punch' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-800">
                              <AlertTriangle className="h-3 w-3" /> Missing Punch
                            </span>
                          )}
                          {item.lateInMinutes > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                              <Clock className="h-3 w-3" /> Late {item.lateInMinutes}m
                            </span>
                          )}
                          {item.earlyOutMinutes > 0 && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                              <Clock className="h-3 w-3" /> Early {item.earlyOutMinutes}m
                            </span>
                          )}
                          {item.status === 'half_day' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                              Half Day
                            </span>
                          )}
                          {item.status === 'absent' && item.punchCount === 0 && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                              Absent
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-4">
                        {item.isRegularized ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                            <CheckCircle2 className="h-3 w-3" /> Regularized
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700">
                            Unresolved
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Keyset Pagination Load More */}
        {nextCursor && (
          <div className="p-4 border-t bg-slate-50/50 flex justify-center">
            <button
              onClick={() => fetchExceptions(true)}
              disabled={isLoadingMore}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition disabled:opacity-50"
            >
              {isLoadingMore ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Load More Exceptions
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
