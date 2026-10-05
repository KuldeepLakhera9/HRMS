'use client';

import React, { useState, useEffect, useCallback, useTransition } from 'react';
import {
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  X,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sliders,
  FileText,
} from 'lucide-react';

interface LeaveType {
  id: string;
  code: string;
  name: string;
  isPaid: boolean;
  unit: string;
  allowHalfDay: boolean;
}

interface LeaveBalance {
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeName: string;
  opening: number;
  accrued: number;
  used: number;
  adjusted: number;
  pending: number;
  closing: number;
  available: number;
}

interface LeaveRequestItem {
  id: string;
  leaveTypeId: string;
  leaveTypeName?: string;
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'withdrawn';
  createdAt: string;
}

interface PreviewResult {
  totalDays: number;
  balanceBefore: number;
  balanceAfter: number;
  warnings: string[];
  violations: string[];
  approvalRoute: Array<{ level: number; role: string; approverName: string }>;
  holidaysInRange: string[];
}

export default function LeaveManagementPage() {
  const [activeTab, setActiveTab] = useState<'apply' | 'balances' | 'requests' | 'calendar' | 'admin'>('apply');
  const [isPending, startTransition] = useTransition();

  // Reference Data
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequestItem[]>([]);
  const [calendarData, setCalendarData] = useState<Record<string, unknown>>({});
  const [calendarScope, setCalendarScope] = useState<'me' | 'team' | 'department' | 'company'>('team');
  const [calendarMonth, setCalendarMonth] = useState('2026-08');

  // Apply Form State
  const [selectedTypeId, setSelectedTypeId] = useState<string>('');
  const [fromDate, setFromDate] = useState<string>('2026-08-10');
  const [toDate, setToDate] = useState<string>('2026-08-11');
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [fromPart, setFromPart] = useState<'full' | 'first' | 'second'>('full');
  const [reason, setReason] = useState<string>('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Admin Adjustment Dialog State
  const [adminEmployeeId, setAdminEmployeeId] = useState('');
  const [adminTypeId, setAdminTypeId] = useState('');
  const [adminDeltaDays, setAdminDeltaDays] = useState('1.0');
  const [adminReason, setAdminReason] = useState('');
  const [isAdjusting, setIsAdjusting] = useState(false);

  // Load types & balances
  const loadInitialData = useCallback(async () => {
    try {
      const [typesRes, balRes] = await Promise.all([
        fetch('/api/v1/leave/types'),
        fetch('/api/v1/leave/balances'),
      ]);
      if (typesRes.ok) {
        const json = await typesRes.json();
        setLeaveTypes(json.data || []);
        if (json.data && json.data.length > 0 && !selectedTypeId) {
          setSelectedTypeId(json.data[0].id);
        }
      }
      if (balRes.ok) {
        const json = await balRes.json();
        setBalances(json.data || []);
      }
    } catch (err) {
      console.error('Failed to load leave reference data', err);
    }
  }, [selectedTypeId]);

  const loadRequests = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/leave/requests');
      if (res.ok) {
        const json = await res.json();
        setRequests(json.data || []);
      }
    } catch (err) {
      console.error('Failed to load leave requests', err);
    }
  }, []);

  const loadCalendar = useCallback(async () => {
    try {
      const startDate = `${calendarMonth}-01`;
      const endDate = `${calendarMonth}-31`;
      const res = await fetch(`/api/v1/leave/calendar?startDate=${startDate}&endDate=${endDate}&scope=${calendarScope}`);
      if (res.ok) {
        const json = await res.json();
        setCalendarData(json.data || {});
      }
    } catch (err) {
      console.error('Failed to load leave calendar', err);
    }
  }, [calendarMonth, calendarScope]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  useEffect(() => {
    if (activeTab === 'requests') loadRequests();
    if (activeTab === 'calendar') loadCalendar();
  }, [activeTab, loadRequests, loadCalendar]);

  // Live preview effect with debouncing
  useEffect(() => {
    if (!selectedTypeId || !fromDate || !toDate) {
      setPreview(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsPreviewLoading(true);
      try {
        const res = await fetch('/api/v1/leave/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leaveTypeId: selectedTypeId,
            fromDate,
            toDate,
            fromPart: isHalfDay ? fromPart : 'full',
            reason: reason || 'Preview calculation',
          }),
        });

        if (res.ok) {
          const json = await res.json();
          setPreview(json.data || null);
        } else {
          const errJson = await res.json().catch(() => ({}));
          setPreview({
            totalDays: 0,
            balanceBefore: 0,
            balanceAfter: 0,
            warnings: [],
            violations: [errJson.error?.message || 'Calculation error'],
            approvalRoute: [],
            holidaysInRange: [],
          });
        }
      } catch (err) {
        console.error('Preview error', err);
      } finally {
        setIsPreviewLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [selectedTypeId, fromDate, toDate, isHalfDay, fromPart, reason]);

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTypeId || !fromDate || !toDate) return;

    startTransition(async () => {
      try {
        const res = await fetch('/api/v1/leave/requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            leaveTypeId: selectedTypeId,
            fromDate,
            toDate,
            fromPart: isHalfDay ? fromPart : 'full',
            reason: reason || 'Leave request submission',
          }),
        });

        if (res.ok) {
          setToast({ message: 'Leave request submitted successfully!', type: 'success' });
          setReason('');
          loadInitialData();
          setActiveTab('requests');
        } else {
          const json = await res.json().catch(() => ({}));
          setToast({ message: json.error?.message || 'Failed to submit leave request', type: 'error' });
        }
      } catch {
        setToast({ message: 'Submission failed. Please check network connection.', type: 'error' });
      }
    });
  };

  const handleCancelRequest = async (requestId: string) => {
    try {
      const res = await fetch(`/api/v1/leave/requests/${requestId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Employee cancellation' }),
      });
      if (res.ok) {
        setToast({ message: 'Request cancelled successfully', type: 'success' });
        loadRequests();
        loadInitialData();
      } else {
        const json = await res.json().catch(() => ({}));
        setToast({ message: json.error?.message || 'Failed to cancel request', type: 'error' });
      }
    } catch {
      setToast({ message: 'Action failed', type: 'error' });
    }
  };

  const handleAdminAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminEmployeeId || !adminTypeId || !adminDeltaDays || !adminReason) {
      setToast({ message: 'Please fill all required adjustment fields', type: 'error' });
      return;
    }

    setIsAdjusting(true);
    try {
      const res = await fetch('/api/v1/leave/balances/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employeeId: adminEmployeeId,
          leaveTypeId: adminTypeId,
          amount: parseFloat(adminDeltaDays),
          reason: adminReason,
          year: new Date().getFullYear(),
        }),
      });

      if (res.ok) {
        setToast({ message: 'Balance adjustment recorded successfully!', type: 'success' });
        setAdminReason('');
        loadInitialData();
      } else {
        const json = await res.json().catch(() => ({}));
        setToast({ message: json.error?.message || 'Adjustment failed', type: 'error' });
      }
    } catch {
      setToast({ message: 'Network error during adjustment', type: 'error' });
    } finally {
      setIsAdjusting(false);
    }
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '1.5rem', color: 'var(--text-primary)' }}>
      {/* Toast Notification */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 100,
            padding: '1rem 1.5rem',
            borderRadius: '8px',
            backgroundColor: toast.type === 'success' ? 'var(--success)' : 'var(--danger)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}
        >
          {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', marginLeft: '0.5rem' }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
            Leave & Time-Off Management
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Live calculations, balance tracking, and team calendar
          </p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          borderBottom: '1px solid var(--border-color)',
          marginBottom: '2rem',
        }}
      >
        {[
          { key: 'apply', label: 'Apply Leave', icon: Plus },
          { key: 'balances', label: 'My Balances', icon: Sliders },
          { key: 'requests', label: 'My Requests', icon: Clock },
          { key: 'calendar', label: 'Leave Calendar', icon: Calendar },
          { key: 'admin', label: 'Admin Adjustments', icon: ShieldAlert },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.75rem 1.25rem',
                border: 'none',
                background: 'transparent',
                color: isActive ? 'var(--primary)' : 'var(--text-secondary)',
                fontWeight: isActive ? 600 : 500,
                borderBottom: isActive ? '2px solid var(--primary)' : '2px solid transparent',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              <Icon size={16} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: APPLY LEAVE */}
      {activeTab === 'apply' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '2rem' }}>
          {/* Apply Form */}
          <div className="glass-panel" style={{ padding: '1.75rem' }}>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 600, marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <FileText size={18} color="var(--primary)" />
              Submit Time-Off Request
            </h2>

            <form onSubmit={handleSubmitRequest}>
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                  Leave Type *
                </label>
                <select
                  value={selectedTypeId}
                  onChange={(e) => setSelectedTypeId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.85rem',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-input)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                    outline: 'none',
                  }}
                  required
                >
                  {leaveTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.code}) - {t.isPaid ? 'Paid' : 'Unpaid'}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                    From Date *
                  </label>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-input)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-primary)',
                    }}
                    required
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                    To Date *
                  </label>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-input)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-primary)',
                    }}
                    required
                  />
                </div>
              </div>

              {/* Half Day Option */}
              <div style={{ marginBottom: '1.25rem', padding: '0.75rem', backgroundColor: 'var(--bg-input)', borderRadius: '8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                  <input
                    type="checkbox"
                    checked={isHalfDay}
                    onChange={(e) => setIsHalfDay(e.target.checked)}
                  />
                  <span>Half Day Leave</span>
                </label>
                {isHalfDay && (
                  <div style={{ marginTop: '0.75rem', display: 'flex', gap: '1rem' }}>
                    <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <input
                        type="radio"
                        name="halfPart"
                        checked={fromPart === 'first'}
                        onChange={() => setFromPart('first')}
                      />
                      First Half (Morning)
                    </label>
                    <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <input
                        type="radio"
                        name="halfPart"
                        checked={fromPart === 'second'}
                        onChange={() => setFromPart('second')}
                      />
                      Second Half (Afternoon)
                    </label>
                  </div>
                )}
              </div>

              {/* Reason */}
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                  Reason / Purpose
                </label>
                <textarea
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Provide context for approval..."
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.85rem',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-input)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                    resize: 'none',
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={isPending || (preview?.violations && preview.violations.length > 0)}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  backgroundColor: 'var(--primary)',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 600,
                  cursor: isPending || (preview?.violations && preview.violations.length > 0) ? 'not-allowed' : 'pointer',
                  opacity: isPending || (preview?.violations && preview.violations.length > 0) ? 0.6 : 1,
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                {isPending ? 'Submitting...' : 'Submit Leave Request'}
              </button>
            </form>
          </div>

          {/* Live Preview Panel */}
          <div className="glass-panel" style={{ padding: '1.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 600, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Clock size={18} color="var(--primary)" />
                Live Calculation Preview
              </h2>
              {isPreviewLoading && <RefreshCw size={16} className="animate-spin" color="var(--primary)" />}
            </div>

            {preview ? (
              <div>
                {/* Metric Summary Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                  <div style={{ padding: '1rem', backgroundColor: 'var(--bg-input)', borderRadius: '10px' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                      Requested Days
                    </span>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.25rem', color: 'var(--primary)' }}>
                      {preview.totalDays} {preview.totalDays === 1 ? 'day' : 'days'}
                    </div>
                  </div>
                  <div style={{ padding: '1rem', backgroundColor: 'var(--bg-input)', borderRadius: '10px' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                      Balance After
                    </span>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.25rem', color: preview.balanceAfter < 0 ? 'var(--danger)' : 'var(--success)' }}>
                      {preview.balanceAfter} days
                    </div>
                  </div>
                </div>

                {/* Violations */}
                {preview.violations.length > 0 && (
                  <div style={{ marginBottom: '1rem', padding: '0.85rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger)', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--danger)', fontWeight: 600, fontSize: '0.875rem' }}>
                      <AlertCircle size={16} />
                      Blocking Violations
                    </div>
                    <ul style={{ margin: '0.5rem 0 0 1.25rem', fontSize: '0.8rem', color: 'var(--danger)' }}>
                      {preview.violations.map((v, i) => (
                        <li key={i}>{v}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Warnings */}
                {preview.warnings.length > 0 && (
                  <div style={{ marginBottom: '1rem', padding: '0.85rem', backgroundColor: 'rgba(245, 158, 11, 0.1)', border: '1px solid var(--warning)', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--warning)', fontWeight: 600, fontSize: '0.875rem' }}>
                      <AlertTriangle size={16} />
                      Notice & Warnings
                    </div>
                    <ul style={{ margin: '0.5rem 0 0 1.25rem', fontSize: '0.8rem', color: 'var(--warning)' }}>
                      {preview.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Approval Route */}
                {preview.approvalRoute && preview.approvalRoute.length > 0 && (
                  <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                    <h3 style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.75rem', textTransform: 'uppercase' }}>
                      Approval Workflow Path
                    </h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {preview.approvalRoute.map((step, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.85rem' }}>
                          <div style={{ width: '22px', height: '22px', borderRadius: '50%', backgroundColor: 'var(--primary)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700 }}>
                            {step.level}
                          </div>
                          <span style={{ fontWeight: 500 }}>{step.approverName}</span>
                          <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>({step.role})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ padding: '2rem 1rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                Select a leave type and date range to calculate days and simulate approval routing.
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: MY BALANCES */}
      {activeTab === 'balances' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1.5rem' }}>
          {balances.length > 0 ? (
            balances.map((bal) => (
              <div key={bal.leaveTypeId} className="glass-panel" style={{ padding: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>{bal.leaveTypeName}</h3>
                  <span style={{ padding: '0.2rem 0.5rem', backgroundColor: 'var(--bg-input)', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 600 }}>
                    {bal.leaveTypeCode}
                  </span>
                </div>

                <div style={{ fontSize: '2.25rem', fontWeight: 700, color: 'var(--primary)', marginBottom: '0.5rem' }}>
                  {bal.available}
                  <span style={{ fontSize: '0.85rem', fontWeight: 400, color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>
                    days available
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
                  <div>Accrued: <strong style={{ color: 'var(--text-primary)' }}>{bal.accrued}</strong></div>
                  <div>Used: <strong style={{ color: 'var(--text-primary)' }}>{bal.used}</strong></div>
                  <div>Pending: <strong style={{ color: 'var(--warning)' }}>{bal.pending}</strong></div>
                  <div>Closing: <strong style={{ color: 'var(--text-primary)' }}>{bal.closing}</strong></div>
                </div>
              </div>
            ))
          ) : (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)', gridColumn: '1 / -1' }}>
              No leave balances found for current year.
            </div>
          )}
        </div>
      )}

      {/* TAB 3: MY REQUESTS */}
      {activeTab === 'requests' && (
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 600, marginBottom: '1.25rem' }}>Request History & Timeline</h2>
          {requests.length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                  <th style={{ padding: '0.75rem' }}>Type</th>
                  <th style={{ padding: '0.75rem' }}>Dates</th>
                  <th style={{ padding: '0.75rem' }}>Days</th>
                  <th style={{ padding: '0.75rem' }}>Reason</th>
                  <th style={{ padding: '0.75rem' }}>Status</th>
                  <th style={{ padding: '0.75rem' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 500 }}>{r.leaveTypeName || 'Leave'}</td>
                    <td style={{ padding: '0.75rem' }}>{r.fromDate} to {r.toDate}</td>
                    <td style={{ padding: '0.75rem' }}>{r.days}</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-secondary)' }}>{r.reason}</td>
                    <td style={{ padding: '0.75rem' }}>
                      <span
                        style={{
                          padding: '0.25rem 0.65rem',
                          borderRadius: '999px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          backgroundColor:
                            r.status === 'approved' ? 'rgba(16, 185, 129, 0.15)' :
                            r.status === 'rejected' ? 'rgba(239, 68, 68, 0.15)' :
                            r.status === 'pending' ? 'rgba(245, 158, 11, 0.15)' : 'var(--bg-input)',
                          color:
                            r.status === 'approved' ? 'var(--success)' :
                            r.status === 'rejected' ? 'var(--danger)' :
                            r.status === 'pending' ? 'var(--warning)' : 'var(--text-secondary)',
                        }}
                      >
                        {r.status.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem' }}>
                      {(r.status === 'pending' || r.status === 'approved') && (
                        <button
                          onClick={() => handleCancelRequest(r.id)}
                          style={{
                            padding: '0.35rem 0.75rem',
                            borderRadius: '6px',
                            backgroundColor: 'rgba(239, 68, 68, 0.15)',
                            color: 'var(--danger)',
                            border: 'none',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          {r.status === 'pending' ? 'Withdraw' : 'Cancel'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              No leave requests found.
            </div>
          )}
        </div>
      )}

      {/* TAB 4: CALENDAR */}
      {activeTab === 'calendar' && (
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                type="month"
                value={calendarMonth}
                onChange={(e) => setCalendarMonth(e.target.value)}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '6px',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                }}
              />
              <select
                value={calendarScope}
                onChange={(e) => setCalendarScope(e.target.value as typeof calendarScope)}
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: '6px',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                }}
              >
                <option value="me">My Calendar</option>
                <option value="team">Team Scope</option>
                <option value="department">Department Scope</option>
                <option value="company">Company Scope</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}><span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: 'var(--success)' }}></span> Present</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}><span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: 'var(--primary)' }}></span> Leave</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}><span style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: 'var(--warning)' }}></span> Holiday</span>
            </div>
          </div>

          <div style={{ padding: '2rem', textAlign: 'center', backgroundColor: 'var(--bg-input)', borderRadius: '10px' }}>
            <Calendar size={32} color="var(--primary)" style={{ margin: '0 auto 1rem' }} />
            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Calendar View Active ({calendarScope.toUpperCase()})</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
              Fetched data points from query-budget optimized API: {Object.keys(calendarData).length} record collections loaded.
            </p>
          </div>
        </div>
      )}

      {/* TAB 5: ADMIN ADJUSTMENTS */}
      {activeTab === 'admin' && (
        <div className="glass-panel" style={{ padding: '1.75rem', maxWidth: '600px', margin: '0 auto' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 600, marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ShieldAlert size={18} color="var(--primary)" />
            Discretionary Balance Adjustment
          </h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
            Manual adjustments require mandatory reason and write immutable records to the audit ledger.
          </p>

          <form onSubmit={handleAdminAdjustment}>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                Employee ID *
              </label>
              <input
                type="text"
                placeholder="UUID of target employee"
                value={adminEmployeeId}
                onChange={(e) => setAdminEmployeeId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                }}
                required
              />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                Leave Type *
              </label>
              <select
                value={adminTypeId}
                onChange={(e) => setAdminTypeId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                }}
                required
              >
                <option value="">Select type</option>
                {leaveTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.code})
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                Adjustment Delta (+/- Days) *
              </label>
              <input
                type="number"
                step="0.5"
                value={adminDeltaDays}
                onChange={(e) => setAdminDeltaDays(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                }}
                required
              />
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                Mandatory Reason *
              </label>
              <textarea
                rows={3}
                value={adminReason}
                onChange={(e) => setAdminReason(e.target.value)}
                placeholder="Reason for discretionary adjustment (audited)..."
                style={{
                  width: '100%',
                  padding: '0.65rem 0.85rem',
                  borderRadius: '8px',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                  resize: 'none',
                }}
                required
              />
            </div>

            <button
              type="submit"
              disabled={isAdjusting}
              style={{
                width: '100%',
                padding: '0.75rem',
                borderRadius: '8px',
                backgroundColor: 'var(--primary)',
                color: '#fff',
                border: 'none',
                fontWeight: 600,
                cursor: isAdjusting ? 'not-allowed' : 'pointer',
              }}
            >
              {isAdjusting ? 'Adjusting Balance...' : 'Apply Discretionary Adjustment'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
