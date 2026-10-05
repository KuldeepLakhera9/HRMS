'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Users,
  Activity,
  LogIn,
  LogOut,
  Clock,
  Search,
  RefreshCw,
  Building,
  MapPin,
  Radio,
  AlertCircle,
} from 'lucide-react';

interface PresenceItem {
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  departmentName: string | null;
  locationName: string | null;
  status: 'in' | 'out';
  lastPunchId: string;
  lastPunchTime: string;
  shiftDate: string;
}

export default function ManagerLiveBoardPage() {
  const [presenceList, setPresenceList] = useState<PresenceItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'in' | 'out'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sseConnected, setSseConnected] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(new Date());
  const [errorToast, setErrorToast] = useState<string | null>(null);

  const fetchPresence = useCallback(async () => {
    try {
      setIsLoading(true);
      setErrorToast(null);

      const params = new URLSearchParams();
      if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }
      params.set('limit', '100');

      const res = await fetch(`/api/v1/attendance/live/who-is-in?${params.toString()}`);
      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error?.message || 'Failed to load live presence.');
      }

      const json = await res.json();
      setPresenceList(json.data || []);
      setLastRefreshedAt(new Date());
    } catch (err: unknown) {
      setErrorToast(err instanceof Error ? err.message : 'Error fetching presence data.');
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  // Initial fetch and SSE connection
  useEffect(() => {
    fetchPresence();

    // Setup SSE connection
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource('/api/v1/attendance/live/stream');

      eventSource.onopen = () => {
        setSseConnected(true);
      };

      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'punch' || payload.type === 'presence_update') {
            // Live update: refetch or surgically update
            fetchPresence();
          }
        } catch {
          // ignore heartbeats
        }
      };

      eventSource.onerror = () => {
        setSseConnected(false);
      };
    } catch {
      setSseConnected(false);
    }

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [fetchPresence]);

  // Filtered presence items
  const filteredItems = useMemo(() => {
    return presenceList.filter(item => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = item.employeeName.toLowerCase().includes(q);
        const matchesCode = item.employeeNumber.toLowerCase().includes(q);
        const matchesDept = item.departmentName?.toLowerCase().includes(q) ?? false;
        if (!matchesName && !matchesCode && !matchesDept) return false;
      }
      return true;
    });
  }, [presenceList, statusFilter, searchQuery]);

  // Calculate live counts
  const totalIn = presenceList.filter(p => p.status === 'in').length;
  const totalOut = presenceList.filter(p => p.status === 'out').length;
  const totalHeadcount = presenceList.length;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Activity className="h-6 w-6 text-emerald-600" />
            Live Presence Board ("Who is In")
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Real-time workforce attendance tracking, check-in status, and shift monitoring.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* SSE Live Indicator */}
          <div
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border ${
              sseConnected
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : 'bg-amber-50 text-amber-800 border-amber-200'
            }`}
          >
            <Radio className={`h-3.5 w-3.5 ${sseConnected ? 'text-emerald-600 animate-pulse' : 'text-amber-500'}`} />
            <span>{sseConnected ? 'Realtime (SSE Live)' : 'Polling Mode'}</span>
          </div>

          <button
            onClick={() => fetchPresence()}
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition shadow-sm"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {errorToast && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-rose-600" />
            <span>{errorToast}</span>
          </div>
          <button onClick={() => setErrorToast(null)} className="text-rose-600 text-xs font-semibold">
            Dismiss
          </button>
        </div>
      )}

      {/* KPI Counters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">Checked In / On Duty</p>
            <LogIn className="h-5 w-5 text-emerald-600" />
          </div>
          <p className="text-3xl font-black text-emerald-950 mt-2">{totalIn}</p>
          <p className="text-[11px] text-emerald-700 mt-1">Actively on site or approved remote</p>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-700">Checked Out / Off Duty</p>
            <LogOut className="h-5 w-5 text-slate-500" />
          </div>
          <p className="text-3xl font-black text-slate-900 mt-2">{totalOut}</p>
          <p className="text-[11px] text-slate-500 mt-1">Shift concluded or break</p>
        </div>

        <div className="bg-blue-50/70 border border-blue-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-blue-800">Active Presence %</p>
            <Users className="h-5 w-5 text-blue-600" />
          </div>
          <p className="text-3xl font-black text-blue-950 mt-2">
            {totalHeadcount > 0 ? `${Math.round((totalIn / totalHeadcount) * 100)}%` : '0%'}
          </p>
          <p className="text-[11px] text-blue-700 mt-1">Of active roster for today</p>
        </div>

        <div className="bg-purple-50/70 border border-purple-200 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider text-purple-800">Total Tracked</p>
            <Clock className="h-5 w-5 text-purple-600" />
          </div>
          <p className="text-3xl font-black text-purple-950 mt-2">{totalHeadcount}</p>
          <p className="text-[11px] text-purple-700 mt-1">
            Last update: {lastRefreshedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white border rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1 min-w-[240px]">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name, employee ID, department..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full text-xs pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        {/* Status Toggle Tabs */}
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl text-xs font-semibold">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-lg transition ${
              statusFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All ({totalHeadcount})
          </button>
          <button
            onClick={() => setStatusFilter('in')}
            className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
              statusFilter === 'in' ? 'bg-white text-emerald-800 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            In Office ({totalIn})
          </button>
          <button
            onClick={() => setStatusFilter('out')}
            className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
              statusFilter === 'out' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span className="h-2 w-2 rounded-full bg-slate-400" />
            Out ({totalOut})
          </button>
        </div>
      </div>

      {/* Live Presence Table */}
      <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                <th className="p-4">Employee</th>
                <th className="p-4">Department & Location</th>
                <th className="p-4">Live Status</th>
                <th className="p-4">Last Punch Time</th>
                <th className="p-4">Shift Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={5} className="p-10 text-center text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-slate-400" />
                    Connecting to live presence stream...
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-10 text-center text-slate-400">
                    <Users className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                    No employees matching filter criteria.
                  </td>
                </tr>
              ) : (
                filteredItems.map(item => {
                  const isIn = item.status === 'in';
                  return (
                    <tr key={item.employeeId} className="hover:bg-slate-50/80 transition">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div
                            className={`h-9 w-9 rounded-full flex items-center justify-center font-bold text-xs ${
                              isIn ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {item.employeeName.charAt(0)}
                          </div>
                          <div>
                            <p className="font-bold text-slate-900 text-sm">{item.employeeName}</p>
                            <p className="text-[11px] text-slate-500 font-mono">{item.employeeNumber}</p>
                          </div>
                        </div>
                      </td>

                      <td className="p-4 space-y-1">
                        <div className="flex items-center gap-1.5 text-slate-700">
                          <Building className="h-3.5 w-3.5 text-slate-400" />
                          <span>{item.departmentName || 'General Dept'}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-500 text-[11px]">
                          <MapPin className="h-3 w-3 text-slate-400" />
                          <span>{item.locationName || 'HQ'}</span>
                        </div>
                      </td>

                      <td className="p-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                            isIn
                              ? 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          <span
                            className={`h-2 w-2 rounded-full ${isIn ? 'bg-emerald-600 animate-pulse' : 'bg-slate-400'}`}
                          />
                          {isIn ? 'ON DUTY' : 'OUT'}
                        </span>
                      </td>

                      <td className="p-4 font-mono text-slate-700">
                        {new Date(item.lastPunchTime).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </td>

                      <td className="p-4 font-mono text-slate-500">{item.shiftDate}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
