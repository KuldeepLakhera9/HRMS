'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  MapPin,
  CheckCircle2,
  AlertTriangle,
  X,
  ShieldCheck,
  Send,
  RefreshCw,
  Info,
} from 'lucide-react';

interface CalendarDayItem {
  id: string;
  employeeId: string;
  workDate: string;
  status: string;
  shiftId: string | null;
  shiftName: string | null;
  firstIn: string | null;
  lastOut: string | null;
  punchCount: number;
  totalWorkMinutes: number;
  effectiveMinutes: number;
  lateInMinutes: number;
  earlyOutMinutes: number;
  overtimeMinutes: number;
  isRegularized: boolean;
  isLocked: boolean;
}

interface MonthSummary {
  presentDays: number;
  absentDays: number;
  halfDays: number;
  weeklyOffDays: number;
  holidayDays: number;
  exceptionDays: number;
  totalWorkedHours: string;
  overtimeHours: string;
}

interface PunchDetail {
  id: string;
  punchTime: string;
  punchType: 'in' | 'out' | 'auto_out';
  source: string;
  isSynthetic?: boolean;
  hasLocationData: boolean;
  latitude: number | null;
  longitude: number | null;
  isInsideGeofence?: boolean;
  distanceMeters?: number | null;
}

interface DayDetailData {
  day: CalendarDayItem | null;
  punches: PunchDetail[];
  canViewMap: boolean;
}

export default function AttendanceCalendarPage() {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const [days, setDays] = useState<CalendarDayItem[]>([]);
  const [summary, setSummary] = useState<MonthSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Day Drawer State
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayDetail, setDayDetail] = useState<DayDetailData | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Regularization Modal State
  const [isRegModalOpen, setIsRegModalOpen] = useState(false);
  const [regType, setRegType] = useState<'punch_missing' | 'in_time_change' | 'out_time_change' | 'on_duty' | 'work_from_home'>('punch_missing');
  const [regInTime, setRegInTime] = useState('');
  const [regOutTime, setRegOutTime] = useState('');
  const [regReason, setRegReason] = useState('');
  const [isSubmittingReg, setIsSubmittingReg] = useState(false);

  const fetchCalendar = useCallback(async () => {
    try {
      setIsLoading(true);
      setErrorToast(null);

      const res = await fetch(`/api/v1/attendance/calendar?month=${currentMonth}`);
      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error?.message || 'Failed to load attendance calendar.');
      }

      const json = await res.json();
      setDays(json.data.days || []);
      setSummary(json.data.summary || null);
    } catch (err: unknown) {
      setErrorToast(err instanceof Error ? err.message : 'Error fetching calendar.');
    } finally {
      setIsLoading(false);
    }
  }, [currentMonth]);

  useEffect(() => {
    fetchCalendar();
  }, [fetchCalendar]);

  const handleSelectDay = async (dateStr: string) => {
    setSelectedDate(dateStr);
    setIsLoadingDetail(true);
    setDayDetail(null);

    try {
      const res = await fetch(`/api/v1/attendance/calendar/${dateStr}`);
      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error?.message || 'Failed to load day details.');
      }
      const json = await res.json();
      setDayDetail(json.data);
    } catch (err: unknown) {
      setErrorToast(err instanceof Error ? err.message : 'Error fetching day details.');
    } finally {
      setIsLoadingDetail(false);
    }
  };

  const handleMonthStep = (offset: number) => {
    const [yStr, mStr] = currentMonth.split('-');
    const date = new Date(parseInt(yStr ?? '2026', 10), parseInt(mStr ?? '10', 10) - 1 + offset, 1);
    setCurrentMonth(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
  };

  const handleRegularizationSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDate) return;

    try {
      setIsSubmittingReg(true);
      setErrorToast(null);

      const res = await fetch('/api/v1/attendance/regularizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: selectedDate,
          requestType: regType,
          inTime: regInTime || undefined,
          outTime: regOutTime || undefined,
          reason: regReason,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || 'Regularization request submission failed.');
      }

      setSuccessToast('Regularization request submitted successfully.');
      setIsRegModalOpen(false);
      setRegReason('');
      setRegInTime('');
      setRegOutTime('');
      fetchCalendar();
    } catch (err: unknown) {
      setErrorToast(err instanceof Error ? err.message : 'Error submitting regularization.');
    } finally {
      setIsSubmittingReg(false);
    }
  };

  // Build Calendar Matrix
  const [yearStr, monthStr] = currentMonth.split('-');
  const year = parseInt(yearStr ?? '2026', 10);
  const monthIndex = parseInt(monthStr ?? '10', 10) - 1;
  const firstDayOfWeek = new Date(year, monthIndex, 1).getDay();
  const totalDaysInMonth = new Date(year, monthIndex + 1, 0).getDate();

  const dayMap = new Map<string, CalendarDayItem>();
  for (const d of days) {
    dayMap.set(d.workDate, d);
  }

  const calendarCells = [];
  // Empty leading days
  for (let i = 0; i < firstDayOfWeek; i++) {
    calendarCells.push(null);
  }
  // Days of current month
  for (let d = 1; d <= totalDaysInMonth; d++) {
    const dateStr = `${currentMonth}-${String(d).padStart(2, '0')}`;
    calendarCells.push({
      dateStr,
      dayNum: d,
      item: dayMap.get(dateStr) ?? null,
    });
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <CalendarIcon className="h-6 w-6 text-emerald-600" />
            Attendance Calendar
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Color-coded monthly attendance summary, shift analysis, and regularization controls.
          </p>
        </div>

        {/* Month Navigation & Refresh */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchCalendar()}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition shadow-sm"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-xl p-1 shadow-sm">
            <button
              onClick={() => handleMonthStep(-1)}
              className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 transition"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="font-semibold text-sm px-3 text-slate-800 font-mono">{currentMonth}</span>
            <button
              onClick={() => handleMonthStep(1)}
              className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-600 transition"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
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
            <AlertTriangle className="h-5 w-5 text-rose-600" />
            <span>{errorToast}</span>
          </div>
          <button onClick={() => setErrorToast(null)} className="text-rose-600 hover:text-rose-900 text-xs font-semibold">
            Dismiss
          </button>
        </div>
      )}

      {/* Summary KPI Strip */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Present</p>
            <p className="text-xl font-bold text-emerald-900 mt-0.5">{summary.presentDays} days</p>
          </div>
          <div className="bg-rose-50/70 border border-rose-200 rounded-xl p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-rose-700">Absent</p>
            <p className="text-xl font-bold text-rose-900 mt-0.5">{summary.absentDays} days</p>
          </div>
          <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Half Day</p>
            <p className="text-xl font-bold text-amber-900 mt-0.5">{summary.halfDays} days</p>
          </div>
          <div className="bg-sky-50/70 border border-sky-200 rounded-xl p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-sky-700">Off / Holiday</p>
            <p className="text-xl font-bold text-sky-900 mt-0.5">{summary.weeklyOffDays + summary.holidayDays} days</p>
          </div>
          <div className="bg-orange-50/70 border border-orange-200 rounded-xl p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-orange-700">Exceptions</p>
            <p className="text-xl font-bold text-orange-900 mt-0.5">{summary.exceptionDays} days</p>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-700">Total Worked</p>
            <p className="text-xl font-bold text-slate-900 mt-0.5">{summary.totalWorkedHours}h</p>
          </div>
        </div>
      )}

      {/* Monthly Grid */}
      <div className="bg-white border rounded-xl shadow-sm overflow-hidden p-4">
        {/* Days of week header */}
        <div className="grid grid-cols-7 gap-2 mb-2 text-center text-xs font-semibold text-slate-500 uppercase tracking-wider">
          <div>Sun</div>
          <div>Mon</div>
          <div>Tue</div>
          <div>Wed</div>
          <div>Thu</div>
          <div>Fri</div>
          <div>Sat</div>
        </div>

        {/* Cells */}
        <div className="grid grid-cols-7 gap-2">
          {calendarCells.map((cell, idx) => {
            if (!cell) {
              return <div key={`empty-${idx}`} className="h-24 bg-slate-50/50 rounded-lg border border-dashed border-slate-100" />;
            }

            const { dateStr, dayNum, item } = cell;
            const isSelected = selectedDate === dateStr;

            let bgColor = 'bg-slate-50/50 border-slate-200 text-slate-700';
            const badgeText = item?.status || 'No Record';

            if (item) {
              if (item.status === 'present') {
                bgColor = 'bg-emerald-50/60 border-emerald-200 text-emerald-900 hover:bg-emerald-100/60';
              } else if (item.status === 'absent') {
                bgColor = 'bg-rose-50/60 border-rose-200 text-rose-900 hover:bg-rose-100/60';
              } else if (item.status === 'half_day') {
                bgColor = 'bg-amber-50/60 border-amber-200 text-amber-900 hover:bg-amber-100/60';
              } else if (item.status === 'weekly_off' || item.status === 'holiday') {
                bgColor = 'bg-sky-50/50 border-sky-200 text-sky-900 hover:bg-sky-100/50';
              } else if (item.status === 'missing_punch') {
                bgColor = 'bg-red-50/70 border-red-300 text-red-900 hover:bg-red-100/70';
              }
            }

            const hasAnomaly = item && (item.status === 'missing_punch' || item.lateInMinutes > 0 || item.earlyOutMinutes > 0);

            return (
              <div
                key={dateStr}
                onClick={() => handleSelectDay(dateStr)}
                className={`h-24 p-2 rounded-lg border cursor-pointer transition flex flex-col justify-between ${bgColor} ${
                  isSelected ? 'ring-2 ring-emerald-500 shadow-md' : ''
                }`}
              >
                <div className="flex justify-between items-start">
                  <span className="font-bold text-sm">{dayNum}</span>
                  {hasAnomaly && (
                    <span className="h-2 w-2 rounded-full bg-rose-500" title="Attendance exception" />
                  )}
                </div>

                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider truncate">
                    {badgeText.replace('_', ' ')}
                  </div>
                  {item && item.effectiveMinutes > 0 && (
                    <div className="text-[10px] text-slate-500">
                      {(item.effectiveMinutes / 60).toFixed(1)}h
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Day Drawer Modal */}
      {selectedDate && (
        <div className="fixed inset-y-0 right-0 w-full sm:w-[480px] bg-white shadow-2xl z-50 border-l flex flex-col">
          {/* Drawer Header */}
          <div className="p-4 border-b flex items-center justify-between bg-slate-50">
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <CalendarIcon className="h-5 w-5 text-emerald-600" />
                Day Breakdown: {selectedDate}
              </h2>
              <p className="text-xs text-slate-500">Punches timeline and geolocation audit</p>
            </div>
            <button
              onClick={() => setSelectedDate(null)}
              className="p-1 hover:bg-slate-200 rounded-lg text-slate-500"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {isLoadingDetail ? (
              <div className="py-20 text-center text-slate-400">
                <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-slate-400" />
                Loading day details...
              </div>
            ) : (
              <>
                {/* Day Overview Box */}
                {dayDetail?.day ? (
                  <div className="bg-slate-50 border rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-500 uppercase">Status</span>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-bold uppercase bg-emerald-100 text-emerald-800">
                        {dayDetail.day.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-slate-500">Actual Work:</span>
                        <p className="font-semibold text-slate-800">
                          {(dayDetail.day.totalWorkMinutes / 60).toFixed(1)} hrs
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-500">Effective Hours:</span>
                        <p className="font-semibold text-slate-800">
                          {(dayDetail.day.effectiveMinutes / 60).toFixed(1)} hrs
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-500">Late Arrival:</span>
                        <p className="font-semibold text-slate-800">{dayDetail.day.lateInMinutes} mins</p>
                      </div>
                      <div>
                        <span className="text-slate-500">Early Out:</span>
                        <p className="font-semibold text-slate-800">{dayDetail.day.earlyOutMinutes} mins</p>
                      </div>
                    </div>

                    {dayDetail.day.isRegularized && (
                      <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 p-2 rounded-lg border border-emerald-200">
                        <CheckCircle2 className="h-4 w-4" />
                        Regularized by HR / Workflow
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-4 bg-slate-50 border rounded-xl text-center text-xs text-slate-500">
                    No computed day summary available for this date.
                  </div>
                )}

                {/* Punches Timeline */}
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                    Punches Timeline ({dayDetail?.punches.length || 0})
                  </h3>

                  {dayDetail?.punches.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">No punches recorded on this day.</p>
                  ) : (
                    <div className="space-y-3">
                      {dayDetail?.punches.map(p => (
                        <div key={p.id} className="p-3 bg-white border rounded-xl text-xs space-y-2 shadow-sm">
                          <div className="flex items-center justify-between">
                            <span
                              className={`px-2 py-0.5 rounded font-bold uppercase text-[11px] ${
                                p.punchType === 'in' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              {p.punchType.toUpperCase()}
                            </span>
                            <span className="font-mono text-slate-700">
                              {new Date(p.punchTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-slate-500">
                            <span>Source: <strong className="text-slate-700 capitalize">{p.source}</strong></span>
                            {p.isSynthetic && (
                              <span className="bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded text-[10px] font-semibold">
                                Synthetic
                              </span>
                            )}
                          </div>

                          {/* Geolocation Section */}
                          <div className="pt-2 border-t text-[11px]">
                            {dayDetail.canViewMap ? (
                              p.latitude !== null && p.longitude !== null ? (
                                <div className="flex items-center gap-1.5 text-slate-700">
                                  <MapPin className="h-3.5 w-3.5 text-blue-600 flex-shrink-0" />
                                  <span>
                                    Coords: {p.latitude.toFixed(4)}, {p.longitude.toFixed(4)}
                                    {p.distanceMeters !== null && p.distanceMeters !== undefined && ` (${p.distanceMeters}m from site)`}
                                  </span>
                                </div>
                              ) : (
                                <div className="text-slate-400 flex items-center gap-1">
                                  <Info className="h-3.5 w-3.5" /> No coordinates recorded
                                </div>
                              )
                            ) : (
                              <div className="text-slate-400 flex items-center gap-1 italic">
                                <ShieldCheck className="h-3.5 w-3.5 text-slate-400" />
                                Map view restricted (requires attendance.punch.view_map permission)
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Regularization Trigger Button */}
                <div className="pt-4 border-t">
                  <button
                    onClick={() => setIsRegModalOpen(true)}
                    className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition shadow"
                  >
                    <Send className="h-4 w-4" />
                    Request Regularization
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Regularization Modal */}
      {isRegModalOpen && selectedDate && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-slate-900 text-base">Request Attendance Regularization</h3>
              <button onClick={() => setIsRegModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleRegularizationSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Target Date</label>
                <input
                  type="text"
                  disabled
                  value={selectedDate}
                  className="w-full bg-slate-100 border border-slate-300 rounded-lg px-3 py-2 text-slate-700 font-mono"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Request Type</label>
                <select
                  value={regType}
                  onChange={e => setRegType(e.target.value as 'punch_missing' | 'in_time_change' | 'out_time_change' | 'on_duty' | 'work_from_home')}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                >
                  <option value="punch_missing">Missing Punch</option>
                  <option value="in_time_change">In-Time Correction</option>
                  <option value="out_time_change">Out-Time Correction</option>
                  <option value="on_duty">On Duty (OD)</option>
                  <option value="work_from_home">Work From Home (WFH)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">In Time (HH:mm)</label>
                  <input
                    type="time"
                    value={regInTime}
                    onChange={e => setRegInTime(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Out Time (HH:mm)</label>
                  <input
                    type="time"
                    value={regOutTime}
                    onChange={e => setRegOutTime(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Reason / Justification</label>
                <textarea
                  rows={3}
                  required
                  placeholder="Provide detailed explanation for regularization request..."
                  value={regReason}
                  onChange={e => setRegReason(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <button
                  type="button"
                  onClick={() => setIsRegModalOpen(false)}
                  className="px-4 py-2 border rounded-lg text-slate-600 hover:bg-slate-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingReg}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition disabled:opacity-50"
                >
                  {isSubmittingReg ? 'Submitting...' : 'Submit Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
