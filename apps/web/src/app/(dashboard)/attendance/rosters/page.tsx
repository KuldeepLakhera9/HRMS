'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar,
  Clock,
  Filter,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Save,
  ChevronLeft,
  ChevronRight,
  Sparkles,
} from 'lucide-react';

interface Shift {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  color: string;
}

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  department: string;
  code: string;
}

interface RosterCell {
  shiftId: string | null; // null represents Weekly Off
  shiftCode: string;
  isDirty?: boolean;
  conflict?: string | null;
}

const DEFAULT_SHIFTS: Shift[] = [
  { id: 'shift-gen', code: 'GEN', name: 'General Shift (09:00 - 18:00)', startTime: '09:00', endTime: '18:00', crossesMidnight: false, color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { id: 'shift-mor', code: 'MOR', name: 'Morning Shift (06:00 - 15:00)', startTime: '06:00', endTime: '15:00', crossesMidnight: false, color: 'bg-amber-50 text-amber-700 border-amber-200' },
  { id: 'shift-eve', code: 'EVE', name: 'Evening Shift (14:00 - 23:00)', startTime: '14:00', endTime: '23:00', crossesMidnight: false, color: 'bg-purple-50 text-purple-700 border-purple-200' },
  { id: 'shift-nit', code: 'NIT', name: 'Night Shift (22:00 - 07:00)', startTime: '22:00', endTime: '07:00', crossesMidnight: true, color: 'bg-indigo-900 text-indigo-100 border-indigo-700' },
  { id: 'shift-off', code: 'OFF', name: 'Weekly Off', startTime: '--:--', endTime: '--:--', crossesMidnight: false, color: 'bg-gray-100 text-gray-600 border-gray-200' },
];

export default function RosterBuilderPage() {
  const [shifts, setShifts] = useState<Shift[]>(DEFAULT_SHIFTS);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDepartment, setSelectedDepartment] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Matrix: employeeId -> dateStr -> RosterCell
  const [grid, setGrid] = useState<Record<string, Record<string, RosterCell>>>({});
  const [draggedShift, setDraggedShift] = useState<Shift | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [errorToast, setErrorToast] = useState<string | null>(null);

  // Compute dates for the current week (Monday to Sunday)
  const getWeekDates = useCallback((offset: number) => {
    const now = new Date();
    const currentDay = now.getDay();
    const distanceToMonday = (currentDay + 6) % 7;
    const monday = new Date(now);
    monday.setDate(now.getDate() - distanceToMonday + offset * 7);

    const dates: { dateStr: string; label: string; dayName: string; isWeekend: boolean }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dateStr = d.toISOString().split('T')[0]!;
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      dates.push({ dateStr, label, dayName, isWeekend });
    }
    return dates;
  }, []);

  const weekDates = getWeekDates(weekOffset);

  // Load shifts & employees
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [shiftsRes, empRes] = await Promise.all([
        fetch('/api/v1/attendance/shifts'),
        fetch('/api/v1/employees?limit=50'),
      ]);

      if (shiftsRes.ok) {
        const json = await shiftsRes.json();
        if (json.data && json.data.length > 0) {
          const mapped: Shift[] = json.data.map((s: Shift) => ({
            id: s.id,
            code: s.code,
            name: s.name,
            startTime: s.startTime,
            endTime: s.endTime,
            crossesMidnight: s.crossesMidnight,
            color: s.crossesMidnight
              ? 'bg-indigo-900 text-indigo-100 border-indigo-700'
              : s.code.includes('MOR')
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : s.code.includes('EVE')
              ? 'bg-purple-50 text-purple-700 border-purple-200'
              : 'bg-blue-50 text-blue-700 border-blue-200',
          }));
          mapped.push(DEFAULT_SHIFTS[4]!); // add OFF
          setShifts(mapped);
        }
      }

      if (empRes.ok) {
        const json = await empRes.json();
        const emps: Employee[] = (json.data?.items || json.data || []).map((e: { id: string; firstName?: string; lastName?: string; employeeCode?: string; department?: { name?: string } }) => ({
          id: e.id,
          firstName: e.firstName || 'Employee',
          lastName: e.lastName || '',
          department: e.department?.name || 'General',
          code: e.employeeCode || 'EMP',
        }));
        setEmployees(emps);

        // Initialize default grid state
        const initialGrid: Record<string, Record<string, RosterCell>> = {};
        for (const emp of emps) {
          initialGrid[emp.id] = {};
          weekDates.forEach((w, index) => {
            const isOff = index >= 5; // Sat/Sun off by default
            initialGrid[emp.id]![w.dateStr] = {
              shiftId: isOff ? null : 'shift-gen',
              shiftCode: isOff ? 'OFF' : 'GEN',
              isDirty: false,
              conflict: null,
            };
          });
        }
        setGrid(initialGrid);
      }
    } catch (err) {
      console.error('Error loading roster data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [weekDates]);

  useEffect(() => {
    loadData();
  }, [weekOffset]);

  // Conflict detection checker
  const checkConflicts = (empId: string, updatedGrid: Record<string, Record<string, RosterCell>>) => {
    const empCells = updatedGrid[empId];
    if (!empCells) return;

    let consecutiveWorkDays = 0;
    const sortedDates = Object.keys(empCells).sort();

    for (const d of sortedDates) {
      const cell = empCells[d]!;
      if (cell.shiftCode !== 'OFF') {
        consecutiveWorkDays++;
        if (consecutiveWorkDays > 6) {
          cell.conflict = 'Excessive consecutive days (>6 days without weekly off)';
        } else {
          cell.conflict = null;
        }
      } else {
        consecutiveWorkDays = 0;
        cell.conflict = null;
      }
    }
  };

  // Drag and Drop Handlers
  const handleDragStart = (shift: Shift) => {
    setDraggedShift(shift);
  };

  const handleDrop = (empId: string, dateStr: string) => {
    if (!draggedShift) return;
    assignShift(empId, dateStr, draggedShift);
    setDraggedShift(null);
  };

  const assignShift = (empId: string, dateStr: string, shift: Shift) => {
    setGrid(prev => {
      const updated = { ...prev };
      if (!updated[empId]) updated[empId] = {};
      updated[empId]![dateStr] = {
        shiftId: shift.code === 'OFF' ? null : shift.id,
        shiftCode: shift.code,
        isDirty: true,
        conflict: null,
      };
      checkConflicts(empId, updated);
      return updated;
    });
  };

  // Batch Publish Roster
  const handleBatchPublish = async () => {
    setIsPublishing(true);
    setErrorToast(null);
    try {
      const assignments: { employeeId: string; shiftId: string; startDate: string; endDate: string }[] = [];

      for (const [empId, days] of Object.entries(grid)) {
        for (const [dateStr, cell] of Object.entries(days)) {
          if (cell.isDirty && cell.shiftId) {
            assignments.push({
              employeeId: empId,
              shiftId: cell.shiftId,
              startDate: dateStr,
              endDate: dateStr,
            });
          }
        }
      }

      if (assignments.length === 0) {
        setSuccessToast('No unsaved roster changes to publish.');
        return;
      }

      const res = await fetch('/api/v1/attendance/rosters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignments }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to publish roster assignments.');
      }

      // Mark all clean
      setGrid(prev => {
        const updated = { ...prev };
        for (const empId of Object.keys(updated)) {
          for (const dateStr of Object.keys(updated[empId]!)) {
            if (updated[empId]![dateStr]) {
              updated[empId]![dateStr]!.isDirty = false;
            }
          }
        }
        return updated;
      });

      setSuccessToast(`Successfully published ${assignments.length} roster assignments!`);
    } catch (err: unknown) {
      setErrorToast(err instanceof Error ? err.message : 'Unknown error during publish.');
    } finally {
      setIsPublishing(false);
    }
  };

  const dirtyCount = Object.values(grid).reduce((acc, days) => {
    return acc + Object.values(days).filter(c => c.isDirty).length;
  }, 0);

  const filteredEmployees = employees.filter(emp => {
    const matchesDept = selectedDepartment === 'all' || emp.department === selectedDepartment;
    const matchesQuery = !searchQuery || `${emp.firstName} ${emp.lastName} ${emp.code}`.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesDept && matchesQuery;
  });

  const departments = Array.from(new Set(employees.map(e => e.department)));

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <Calendar className="w-6 h-6 text-blue-600" />
            <h1 className="text-2xl font-bold text-gray-900">Shift Roster Builder</h1>
            <span className="bg-blue-100 text-blue-700 text-xs px-2.5 py-0.5 rounded-full font-medium">Sprint 2.3</span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Drag-and-drop shift assignments onto employee schedules with automatic compliance and clash detection.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setWeekOffset(prev => prev - 1)}
            className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
            title="Previous Week"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="text-sm font-semibold text-gray-800 min-w-36 text-center">
            {weekDates[0]?.label} - {weekDates[6]?.label}
          </div>
          <button
            onClick={() => setWeekOffset(prev => prev + 1)}
            className="p-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
            title="Next Week"
          >
            <ChevronRight className="w-5 h-5" />
          </button>

          <button
            onClick={handleBatchPublish}
            disabled={isPublishing || dirtyCount === 0}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
              dirtyCount > 0
                ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
          >
            <Save className="w-4 h-4" />
            {isPublishing ? 'Publishing...' : `Publish Changes (${dirtyCount})`}
          </button>
        </div>
      </div>

      {/* Toast Feedback */}
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

      {/* Shift Palette (Draggable Tokens) */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-amber-500" />
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Shift Palette (Drag onto calendar cells)</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {shifts.map(shift => (
            <div
              key={shift.id}
              draggable
              onDragStart={() => handleDragStart(shift)}
              className={`cursor-grab active:cursor-grabbing px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-2 shadow-sm transition-transform hover:-translate-y-0.5 ${shift.color}`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>{shift.code}</span>
              <span className="font-normal opacity-80">({shift.startTime} - {shift.endTime})</span>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 border border-gray-200 rounded-lg text-sm">
            <Filter className="w-4 h-4 text-gray-500" />
            <select
              value={selectedDepartment}
              onChange={e => setSelectedDepartment(e.target.value)}
              className="bg-transparent border-none text-gray-700 font-medium focus:outline-none"
            >
              <option value="all">All Departments</option>
              {departments.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <input
            type="text"
            placeholder="Search employee by name or ID..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-64 bg-white"
          />
        </div>

        <div className="text-xs text-gray-500">
          Showing <span className="font-semibold text-gray-800">{filteredEmployees.length}</span> employees
        </div>
      </div>

      {/* Roster Calendar Grid */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-600 uppercase">
                <th className="py-3 px-4 min-w-[200px]">Employee</th>
                {weekDates.map(w => (
                  <th
                    key={w.dateStr}
                    className={`py-3 px-3 text-center min-w-[110px] ${
                      w.isWeekend ? 'bg-gray-100/60' : ''
                    }`}
                  >
                    <div>{w.dayName}</div>
                    <div className="text-[10px] font-normal text-gray-400 mt-0.5">{w.label}</div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-gray-200 text-sm">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-gray-400">
                    Loading shift schedules and employee rosters...
                  </td>
                </tr>
              ) : filteredEmployees.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-gray-400">
                    No employees found matching the filters.
                  </td>
                </tr>
              ) : (
                filteredEmployees.map(emp => (
                  <tr key={emp.id} className="hover:bg-blue-50/20 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">
                          {emp.firstName.charAt(0)}{emp.lastName.charAt(0)}
                        </div>
                        <div>
                          <div className="font-semibold text-gray-900 leading-tight">
                            {emp.firstName} {emp.lastName}
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            {emp.code} • {emp.department}
                          </div>
                        </div>
                      </div>
                    </td>

                    {weekDates.map(w => {
                      const cell = grid[emp.id]?.[w.dateStr] || { shiftId: null, shiftCode: 'OFF' };
                      const currentShiftObj = shifts.find(s => s.code === cell.shiftCode) || DEFAULT_SHIFTS[4]!;

                      return (
                        <td
                          key={w.dateStr}
                          onDragOver={e => e.preventDefault()}
                          onDrop={() => handleDrop(emp.id, w.dateStr)}
                          className={`p-2 text-center align-middle transition-colors relative border-l border-gray-100 ${
                            w.isWeekend ? 'bg-gray-50/40' : ''
                          }`}
                        >
                          <div
                            className={`p-2 rounded-lg border text-xs font-medium cursor-pointer transition-all flex flex-col items-center justify-center gap-1 ${
                              currentShiftObj.color
                            } ${cell.isDirty ? 'ring-2 ring-blue-400 ring-offset-1 font-bold' : ''}`}
                            onClick={() => {
                              // Quick rotate to next shift on click
                              const currentIndex = shifts.findIndex(s => s.code === cell.shiftCode);
                              const nextShift = shifts[(currentIndex + 1) % shifts.length]!;
                              assignShift(emp.id, w.dateStr, nextShift);
                            }}
                            title="Drag shift here or click to rotate"
                          >
                            <span>{cell.shiftCode}</span>
                            {cell.conflict && (
                              <div
                                className="absolute -top-1 -right-1 bg-amber-500 text-white rounded-full p-0.5 shadow-sm"
                                title={cell.conflict}
                              >
                                <AlertTriangle className="w-3 h-3" />
                              </div>
                            )}
                          </div>
                        </td>
                      );
                    })}
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
