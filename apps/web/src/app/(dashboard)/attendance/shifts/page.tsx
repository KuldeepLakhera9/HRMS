'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Clock,
  Plus,
  Moon,
  Sun,
  Edit2,
  CheckCircle2,
  AlertCircle,
  X,
  RefreshCw,
  Search,
} from 'lucide-react';

interface ShiftItem {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  graceMinutes: number;
  breakMinutes: number;
  workHours: string;
  createdAt: string;
}

export default function ShiftsAdminPage() {
  const [shifts, setShifts] = useState<ShiftItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);

  // Form State
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [crossesMidnight, setCrossesMidnight] = useState(false);
  const [graceMinutes, setGraceMinutes] = useState(15);
  const [breakMinutes, setBreakMinutes] = useState(60);
  const [workHours, setWorkHours] = useState('8.00');

  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const fetchShifts = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/v1/attendance/shifts');
      if (res.ok) {
        const json = await res.json();
        setShifts(json.data || []);
      }
    } catch (err) {
      console.error('Failed to load shifts:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchShifts();
  }, [fetchShifts]);

  // Automatically adjust crossesMidnight & workHours when times change
  useEffect(() => {
    if (!startTime || !endTime) return;
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);

    if (startH === undefined || startM === undefined || endH === undefined || endM === undefined) return;

    let isCrossing = false;
    let totalMinutes = 0;

    if (endH < startH || (endH === startH && endM < startM)) {
      isCrossing = true;
      totalMinutes = (24 * 60 - (startH * 60 + startM)) + (endH * 60 + endM);
    } else {
      totalMinutes = (endH * 60 + endM) - (startH * 60 + startM);
    }

    setCrossesMidnight(isCrossing);

    const netWorkMinutes = Math.max(0, totalMinutes - breakMinutes);
    const calculatedHours = (netWorkMinutes / 60).toFixed(2);
    setWorkHours(calculatedHours);
  }, [startTime, endTime, breakMinutes]);

  const openCreateModal = () => {
    setEditingShiftId(null);
    setCode('');
    setName('');
    setStartTime('09:00');
    setEndTime('18:00');
    setCrossesMidnight(false);
    setGraceMinutes(15);
    setBreakMinutes(60);
    setWorkHours('8.00');
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (shift: ShiftItem) => {
    setEditingShiftId(shift.id);
    setCode(shift.code);
    setName(shift.name);
    setStartTime(shift.startTime.slice(0, 5));
    setEndTime(shift.endTime.slice(0, 5));
    setCrossesMidnight(shift.crossesMidnight);
    setGraceMinutes(shift.graceMinutes);
    setBreakMinutes(shift.breakMinutes);
    setWorkHours(shift.workHours);
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!code.trim() || !name.trim()) {
      setFormError('Shift code and name are required.');
      return;
    }

    setIsSubmitting(true);
    try {
      const url = editingShiftId
        ? `/api/v1/attendance/shifts/${editingShiftId}`
        : '/api/v1/attendance/shifts';
      const method = editingShiftId ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          name: name.trim(),
          startTime: startTime.length === 5 ? `${startTime}:00` : startTime,
          endTime: endTime.length === 5 ? `${endTime}:00` : endTime,
          crossesMidnight,
          graceMinutes: Number(graceMinutes),
          breakMinutes: Number(breakMinutes),
          workHours: Number(workHours),
        }),
      });

      if (res.ok) {
        setSuccessToast(`Shift successfully ${editingShiftId ? 'updated' : 'created'}!`);
        setIsModalOpen(false);
        await fetchShifts();
        setTimeout(() => setSuccessToast(null), 4000);
      } else {
        const err = await res.json();
        setFormError(err.message || 'Failed to save shift.');
      }
    } catch {
      setFormError('Network error while saving shift.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredShifts = shifts.filter(
    (s) =>
      s.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
            Attendance Shifts
          </h1>
          <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Configure regular and overnight shifts, cross-midnight attribution rules, and grace periods
          </p>
        </div>

        <button
          onClick={openCreateModal}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            backgroundColor: 'var(--primary)',
            color: '#ffffff',
            border: 'none',
            borderRadius: '6px',
            padding: '0.625rem 1.25rem',
            fontWeight: 600,
            fontSize: '0.875rem',
            cursor: 'pointer',
          }}
        >
          <Plus size={18} />
          Create Shift
        </button>
      </div>

      {/* Success Toast */}
      {successToast && (
        <div
          style={{
            padding: '0.75rem 1rem',
            borderRadius: '6px',
            backgroundColor: 'rgba(22, 163, 74, 0.15)',
            color: '#16a34a',
            border: '1px solid #16a34a',
            fontSize: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <CheckCircle2 size={18} />
          {successToast}
        </div>
      )}

      {/* Filter and Search Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: 'var(--bg-secondary)',
          padding: '0.75rem 1rem',
          borderRadius: '8px',
          border: '1px solid var(--border-color)',
        }}
      >
        <div style={{ position: 'relative', width: '320px' }}>
          <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search shifts by code or name..."
            style={{
              width: '100%',
              padding: '0.45rem 0.75rem 0.45rem 2.25rem',
              borderRadius: '6px',
              border: '1px solid var(--border-color)',
              backgroundColor: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontSize: '0.875rem',
            }}
          />
        </div>

        <button
          onClick={fetchShifts}
          title="Refresh shifts"
          style={{
            background: 'none',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            padding: '0.45rem',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
          }}
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Shifts Grid / List */}
      {isLoading ? (
        <div style={{ padding: '4rem 1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <RefreshCw size={28} style={{ animation: 'spin 1s linear infinite', marginBottom: '0.75rem' }} />
          <p style={{ margin: 0, fontSize: '0.875rem' }}>Loading company shifts...</p>
        </div>
      ) : filteredShifts.length === 0 ? (
        <div
          style={{
            padding: '4rem 1rem',
            textAlign: 'center',
            backgroundColor: 'var(--bg-secondary)',
            borderRadius: '8px',
            border: '1px solid var(--border-color)',
            color: 'var(--text-secondary)',
          }}
        >
          <Clock size={36} style={{ marginBottom: '0.75rem', color: 'var(--primary)' }} />
          <h3 style={{ margin: '0 0 0.25rem 0', color: 'var(--text-primary)' }}>No shifts found</h3>
          <p style={{ margin: '0 0 1rem 0', fontSize: '0.875rem' }}>Create your first shift schedule to assign to employees and rosters.</p>
          <button
            onClick={openCreateModal}
            style={{
              backgroundColor: 'var(--primary)',
              color: '#ffffff',
              border: 'none',
              borderRadius: '6px',
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Create First Shift
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.25rem' }}>
          {filteredShifts.map((shift) => (
            <div
              key={shift.id}
              style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '1.25rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                position: 'relative',
              }}
            >
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <span
                      style={{
                        padding: '2px 6px',
                        borderRadius: '4px',
                        backgroundColor: 'rgba(59, 130, 246, 0.15)',
                        color: '#2563eb',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                      }}
                    >
                      {shift.code}
                    </span>
                    {shift.crossesMidnight && (
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(147, 51, 234, 0.15)',
                          color: '#9333ea',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                        }}
                      >
                        <Moon size={12} /> Night Shift
                      </span>
                    )}
                  </div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {shift.name}
                  </h3>
                </div>

                <button
                  onClick={() => openEditModal(shift)}
                  title="Edit Shift"
                  style={{
                    background: 'none',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    padding: '0.4rem',
                    cursor: 'pointer',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <Edit2 size={15} />
                </button>
              </div>

              {/* Time Details */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '1rem',
                  backgroundColor: 'var(--bg-primary)',
                  padding: '0.75rem',
                  borderRadius: '6px',
                }}
              >
                {shift.crossesMidnight ? <Moon size={20} color="#9333ea" /> : <Sun size={20} color="#eab308" />}
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Operating Hours</span>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>
                    {shift.startTime.slice(0, 5)} - {shift.endTime.slice(0, 5)}
                    {shift.crossesMidnight && <span style={{ fontSize: '0.75rem', color: '#9333ea', marginLeft: '4px' }}>(+1 day)</span>}
                  </p>
                </div>
              </div>

              {/* Metric Badges */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', textAlign: 'center' }}>
                <div style={{ backgroundColor: 'var(--bg-primary)', padding: '0.5rem', borderRadius: '6px' }}>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>Grace Period</span>
                  <p style={{ margin: '0.2rem 0 0 0', fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                    {shift.graceMinutes}m
                  </p>
                </div>

                <div style={{ backgroundColor: 'var(--bg-primary)', padding: '0.5rem', borderRadius: '6px' }}>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>Break Deduct</span>
                  <p style={{ margin: '0.2rem 0 0 0', fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                    {shift.breakMinutes}m
                  </p>
                </div>

                <div style={{ backgroundColor: 'var(--bg-primary)', padding: '0.5rem', borderRadius: '6px' }}>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--text-secondary)' }}>Work Hours</span>
                  <p style={{ margin: '0.2rem 0 0 0', fontWeight: 600, fontSize: '0.875rem', color: '#16a34a' }}>
                    {shift.workHours}h
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Dialog for Create/Edit */}
      {isModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '1rem',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              maxWidth: '520px',
              width: '100%',
              overflow: 'hidden',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.3)',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '1.25rem',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {editingShiftId ? 'Edit Shift Schedule' : 'Create New Shift'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSubmit} style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {formError && (
                <div
                  style={{
                    padding: '0.65rem 0.85rem',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(220, 38, 38, 0.1)',
                    color: '#dc2626',
                    border: '1px solid #dc2626',
                    fontSize: '0.8125rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <AlertCircle size={16} />
                  {formError}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '0.25rem' }}>
                    Shift Code *
                  </label>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="DAY_GEN"
                    required
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                      fontSize: '0.875rem',
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '0.25rem' }}>
                    Shift Name *
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="General Day Shift (9 AM - 6 PM)"
                    required
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                      fontSize: '0.875rem',
                    }}
                  />
                </div>
              </div>

              {/* Start & End Times */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '0.25rem' }}>
                    Start Time *
                  </label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    required
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                      fontSize: '0.875rem',
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '0.25rem' }}>
                    End Time *
                  </label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    required
                    style={{
                      width: '100%',
                      padding: '0.5rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                      fontSize: '0.875rem',
                    }}
                  />
                </div>
              </div>

              {/* Crosses Midnight Notice */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.6rem 0.8rem',
                  borderRadius: '6px',
                  backgroundColor: crossesMidnight ? 'rgba(147, 51, 234, 0.1)' : 'var(--bg-primary)',
                  border: `1px solid ${crossesMidnight ? '#9333ea' : 'var(--border-color)'}`,
                  fontSize: '0.8125rem',
                }}
              >
                <input
                  type="checkbox"
                  id="crossesMidnight"
                  checked={crossesMidnight}
                  onChange={(e) => setCrossesMidnight(e.target.checked)}
                  style={{ cursor: 'pointer' }}
                />
                <label htmlFor="crossesMidnight" style={{ cursor: 'pointer', color: 'var(--text-primary)', fontWeight: 500 }}>
                  This shift crosses midnight into the next calendar day
                </label>
              </div>

              {/* Grace, Break, Work Hours */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '0.25rem' }}>
                    Grace (Mins)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="120"
                    value={graceMinutes}
                    onChange={(e) => setGraceMinutes(Number(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '0.45rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                      fontSize: '0.875rem',
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '0.25rem' }}>
                    Break (Mins)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="240"
                    value={breakMinutes}
                    onChange={(e) => setBreakMinutes(Number(e.target.value))}
                    style={{
                      width: '100%',
                      padding: '0.45rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                      fontSize: '0.875rem',
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-primary)', display: 'block', marginBottom: '0.25rem' }}>
                    Work Hours
                  </label>
                  <input
                    type="text"
                    value={workHours}
                    onChange={(e) => setWorkHours(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.45rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                      fontSize: '0.875rem',
                    }}
                  />
                </div>
              </div>

              {/* Modal Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  style={{
                    background: 'none',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    padding: '0.5rem 1rem',
                    color: 'var(--text-primary)',
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    backgroundColor: 'var(--primary)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '0.5rem 1.25rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontSize: '0.875rem',
                  }}
                >
                  {isSubmitting ? 'Saving...' : editingShiftId ? 'Update Shift' : 'Create Shift'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
