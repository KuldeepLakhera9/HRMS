'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  Search,
  Filter,
  Keyboard,
  CheckSquare,
  Square,
  RefreshCw,
  UserCheck,
} from 'lucide-react';

interface WorkflowInboxItem {
  assigneeRecordId: string;
  requestId: string;
  stepId: string;
  stepName: string;
  stepIndex: number;
  entityType: string;
  entityId: string;
  requesterId: string;
  requesterName: string;
  status: 'pending' | 'acted' | 'cancelled';
  payload: Record<string, unknown>;
  dueAt: string | null;
  isDelegated: boolean;
  createdAt: string;
}

export default function ApprovalsInboxPage() {
  const [items, setItems] = useState<WorkflowInboxItem[]>([]);
  const [selectedTab, setSelectedTab] = useState<'pending' | 'acted' | 'cancelled'>('pending');
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [comments, setComments] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const fetchInbox = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/v1/workflow/inbox?status=${selectedTab}&limit=50`);
      if (res.ok) {
        const json = await res.json();
        setItems(json.data || []);
        setSelectedIndex(0);
        setSelectedIds(new Set());
      }
    } catch (err) {
      console.error('Failed to load workflow inbox:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedTab]);

  useEffect(() => {
    fetchInbox();
  }, [fetchInbox]);

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(
      (item) =>
        item.requesterName.toLowerCase().includes(q) ||
        item.entityType.toLowerCase().includes(q) ||
        item.stepName.toLowerCase().includes(q),
    );
  }, [items, searchQuery]);

  const currentItem = filteredItems[selectedIndex] ?? null;

  // Single item action execution
  const handleExecuteAction = useCallback(
    async (requestId: string, action: 'approve' | 'reject') => {
      setActionLoading(true);
      setFeedbackMessage(null);
      try {
        const res = await fetch(`/api/v1/workflow/requests/${requestId}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: requestId,
            action,
            comments: comments.trim() ? comments.trim() : null,
          }),
        });

        if (res.ok) {
          setFeedbackMessage({
            text: `Request successfully ${action === 'approve' ? 'approved' : 'rejected'}.`,
            type: 'success',
          });
          setComments('');
          await fetchInbox();
        } else {
          const err = await res.json();
          setFeedbackMessage({
            text: err.message || `Failed to ${action} request.`,
            type: 'error',
          });
        }
      } catch {
        setFeedbackMessage({ text: 'Network error executing action.', type: 'error' });
      } finally {
        setActionLoading(false);
      }
    },
    [comments, fetchInbox],
  );

  // Bulk approval execution
  const handleBulkApprove = async () => {
    if (selectedIds.size === 0) return;
    setActionLoading(true);
    setFeedbackMessage(null);

    let successCount = 0;
    for (const reqId of selectedIds) {
      try {
        const res = await fetch(`/api/v1/workflow/requests/${reqId}/action`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: reqId,
            action: 'approve',
            comments: 'Bulk approved from Approvals Inbox',
          }),
        });
        if (res.ok) successCount++;
      } catch {
        // Continue with remaining
      }
    }

    setFeedbackMessage({
      text: `Approved ${successCount} of ${selectedIds.size} selected requests.`,
      type: 'success',
    });
    setSelectedIds(new Set());
    await fetchInbox();
    setActionLoading(false);
  };

  const toggleSelectId = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredItems.map((i) => i.requestId)));
    }
  };

  // Keyboard navigation shortcuts: A (approve), R (reject), J (down), K (up), X (select)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore keystrokes when typing in an input or textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, filteredItems.length - 1));
      } else if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'x' || e.key === 'X') {
        e.preventDefault();
        if (currentItem) {
          toggleSelectId(currentItem.requestId);
        }
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        if (currentItem && currentItem.status === 'pending') {
          handleExecuteAction(currentItem.requestId, 'approve');
        }
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        if (currentItem && currentItem.status === 'pending') {
          handleExecuteAction(currentItem.requestId, 'reject');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredItems, selectedIndex, currentItem, handleExecuteAction]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', minHeight: 'calc(100vh - 120px)' }}>
      {/* Header & Title */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
            Approvals Inbox
          </h1>
          <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Review and act on attendance soft-punches, leave requests, and profile change workflows
          </p>
        </div>

        {/* Keyboard hints banner */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '0.5rem 0.75rem',
            fontSize: '0.75rem',
            color: 'var(--text-secondary)',
          }}
        >
          <Keyboard size={14} />
          <span>Shortcuts:</span>
          <kbd style={{ backgroundColor: 'var(--bg-primary)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-color)', fontWeight: 600 }}>J/K</kbd> navigate
          <kbd style={{ backgroundColor: 'var(--bg-primary)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-color)', fontWeight: 600 }}>A</kbd> approve
          <kbd style={{ backgroundColor: 'var(--bg-primary)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-color)', fontWeight: 600 }}>R</kbd> reject
          <kbd style={{ backgroundColor: 'var(--bg-primary)', padding: '2px 6px', borderRadius: '4px', border: '1px solid var(--border-color)', fontWeight: 600 }}>X</kbd> select
        </div>
      </div>

      {/* Status Filter Tabs & Bulk Actions */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid var(--border-color)',
          paddingBottom: '0.75rem',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {(['pending', 'acted', 'cancelled'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setSelectedTab(tab)}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '6px',
                border: 'none',
                fontWeight: 600,
                fontSize: '0.875rem',
                cursor: 'pointer',
                transition: 'all 0.2s',
                backgroundColor: selectedTab === tab ? 'var(--primary)' : 'transparent',
                color: selectedTab === tab ? '#ffffff' : 'var(--text-secondary)',
              }}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {tab === 'pending' && items.length > 0 && selectedTab === 'pending' && (
                <span
                  style={{
                    marginLeft: '0.5rem',
                    backgroundColor: 'rgba(255, 255, 255, 0.25)',
                    padding: '2px 6px',
                    borderRadius: '10px',
                    fontSize: '0.75rem',
                  }}
                >
                  {items.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Bulk Action Controls */}
        {selectedTab === 'pending' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button
              onClick={toggleSelectAll}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                background: 'none',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                padding: '0.4rem 0.75rem',
                fontSize: '0.8125rem',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
              }}
            >
              {selectedIds.size > 0 && selectedIds.size === filteredItems.length ? (
                <CheckSquare size={16} />
              ) : (
                <Square size={16} />
              )}
              {selectedIds.size > 0 ? `Deselect All (${selectedIds.size})` : 'Select All'}
            </button>

            {selectedIds.size > 0 && (
              <button
                onClick={handleBulkApprove}
                disabled={actionLoading}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  backgroundColor: '#16a34a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '0.4rem 0.875rem',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <CheckCircle2 size={16} />
                Approve Selected ({selectedIds.size})
              </button>
            )}

            <button
              onClick={fetchInbox}
              title="Refresh inbox"
              style={{
                background: 'none',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                padding: '0.4rem',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
              }}
            >
              <RefreshCw size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Feedback banner */}
      {feedbackMessage && (
        <div
          style={{
            padding: '0.75rem 1rem',
            borderRadius: '6px',
            backgroundColor: feedbackMessage.type === 'success' ? 'rgba(22, 163, 74, 0.1)' : 'rgba(220, 38, 38, 0.1)',
            color: feedbackMessage.type === 'success' ? '#16a34a' : '#dc2626',
            border: `1px solid ${feedbackMessage.type === 'success' ? '#16a34a' : '#dc2626'}`,
            fontSize: '0.875rem',
          }}
        >
          {feedbackMessage.text}
        </div>
      )}

      {/* Main Dual-Pane Section */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 420px) 1fr', gap: '1.5rem', flex: 1 }}>
        {/* Left Column: List Pane */}
        <div
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* Search Bar */}
          <div style={{ padding: '0.75rem', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search
                size={16}
                style={{ position: 'absolute', left: '0.75rem', color: 'var(--text-secondary)' }}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search requester, request type..."
                style={{
                  width: '100%',
                  padding: '0.5rem 0.75rem 0.5rem 2.25rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.875rem',
                }}
              />
            </div>
          </div>

          {/* List of Requests */}
          <div style={{ flex: 1, overflowY: 'auto', maxHeight: 'calc(100vh - 300px)' }}>
            {isLoading ? (
              <div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                <RefreshCw size={24} style={{ animation: 'spin 1s linear infinite', marginBottom: '0.5rem' }} />
                <p style={{ margin: 0, fontSize: '0.875rem' }}>Loading inbox items...</p>
              </div>
            ) : filteredItems.length === 0 ? (
              <div style={{ padding: '3rem 1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                <CheckCircle2 size={32} style={{ color: 'var(--primary)', marginBottom: '0.75rem' }} />
                <h4 style={{ margin: '0 0 0.25rem 0', color: 'var(--text-primary)' }}>No requests in inbox</h4>
                <p style={{ margin: 0, fontSize: '0.8125rem' }}>You are completely caught up with all approvals!</p>
              </div>
            ) : (
              filteredItems.map((item, idx) => {
                const isSelected = idx === selectedIndex;
                const isChecked = selectedIds.has(item.requestId);
                const isPunchReview = item.entityType === 'attendance_punch_review';

                return (
                  <div
                    key={item.requestId}
                    onClick={() => setSelectedIndex(idx)}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.75rem',
                      padding: '1rem',
                      borderBottom: '1px solid var(--border-color)',
                      backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                      cursor: 'pointer',
                      borderLeft: isSelected ? '3px solid var(--primary)' : '3px solid transparent',
                      transition: 'background-color 0.15s',
                    }}
                  >
                    {/* Checkbox for bulk */}
                    {selectedTab === 'pending' && (
                      <div
                        onClick={(e) => toggleSelectId(item.requestId, e)}
                        style={{ marginTop: '2px', cursor: 'pointer', color: 'var(--text-secondary)' }}
                      >
                        {isChecked ? <CheckSquare size={16} color="var(--primary)" /> : <Square size={16} />}
                      </div>
                    )}

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--text-primary)' }}>
                          {item.requesterName}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {new Date(item.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: '0.35rem 0' }}>
                        <span
                          style={{
                            fontSize: '0.6875rem',
                            fontWeight: 600,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: isPunchReview ? 'rgba(234, 179, 8, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                            color: isPunchReview ? '#ca8a04' : '#2563eb',
                          }}
                        >
                          {isPunchReview ? 'PUNCH REVIEW' : item.entityType.toUpperCase()}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          Step: {item.stepName}
                        </span>
                      </div>

                      {isPunchReview && (
                        <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {String(item.payload.punchType || 'IN').toUpperCase()} punch outside geofence ({Math.round(Number(item.payload.distanceMeters || 0))}m)
                        </p>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Detail Pane */}
        <div
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '8px',
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
          }}
        >
          {currentItem ? (
            <>
              {/* Request Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        backgroundColor: currentItem.status === 'pending' ? 'rgba(234, 179, 8, 0.2)' : 'rgba(22, 163, 74, 0.2)',
                        color: currentItem.status === 'pending' ? '#ca8a04' : '#16a34a',
                      }}
                    >
                      {currentItem.status.toUpperCase()}
                    </span>
                    <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                      Request #{currentItem.requestId.slice(0, 8)}
                    </span>
                  </div>
                  <h2 style={{ margin: '0 0 0.25rem 0', fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {currentItem.entityType === 'attendance_punch_review'
                      ? 'Attendance Punch Outside Geofence'
                      : `Workflow Approval: ${currentItem.entityType}`}
                  </h2>
                  <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    Submitted by <strong>{currentItem.requesterName}</strong> on{' '}
                    {new Date(currentItem.createdAt).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Attendance Punch Specific Telemetry Card */}
              {currentItem.entityType === 'attendance_punch_review' && (
                <div
                  style={{
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    padding: '1.25rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '1rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <AlertTriangle color="#eab308" size={20} />
                    <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--text-primary)' }}>
                      Soft-Policy Geofence Exception Detected
                    </span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Punch Type</span>
                      <p style={{ margin: '0.25rem 0 0 0', fontWeight: 600, fontSize: '1rem', color: 'var(--text-primary)' }}>
                        {String(currentItem.payload.punchType || 'IN').toUpperCase()}
                      </p>
                    </div>

                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Punch Timestamp</span>
                      <p style={{ margin: '0.25rem 0 0 0', fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                        {currentItem.payload.punchTime
                          ? new Date(String(currentItem.payload.punchTime)).toLocaleTimeString()
                          : 'N/A'}
                      </p>
                    </div>

                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Distance From Perimeter</span>
                      <p style={{ margin: '0.25rem 0 0 0', fontWeight: 600, fontSize: '1rem', color: '#eab308' }}>
                        {Math.round(Number(currentItem.payload.distanceMeters || 0))} meters outside
                      </p>
                    </div>

                    <div>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Reason Code</span>
                      <p style={{ margin: '0.25rem 0 0 0', fontWeight: 600, fontSize: '0.875rem', color: 'var(--text-primary)' }}>
                        {String(currentItem.payload.reasonCode || 'PENDING_MANAGER_APPROVAL')}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Approval Stepper / Workflow Progress */}
              <div
                style={{
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  padding: '1.25rem',
                }}
              >
                <h4 style={{ margin: '0 0 1rem 0', fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  APPROVAL STEPPER
                </h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#16a34a' }}>
                    <CheckCircle2 size={18} />
                    <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>1. Submission</span>
                  </div>
                  <ArrowRight size={16} color="var(--border-color)" />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: currentItem.status === 'pending' ? 'var(--primary)' : '#16a34a' }}>
                    <UserCheck size={18} />
                    <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>2. Manager Review (Current)</span>
                  </div>
                  <ArrowRight size={16} color="var(--border-color)" />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: currentItem.status === 'pending' ? 'var(--text-secondary)' : '#16a34a' }}>
                    <CheckCircle2 size={18} />
                    <span style={{ fontSize: '0.875rem', fontWeight: 600 }}>3. Effective Punch Updated</span>
                  </div>
                </div>
              </div>

              {/* Action Section (Only visible for pending requests) */}
              {currentItem.status === 'pending' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: 'auto' }}>
                  <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    Review Comments (Optional)
                  </label>
                  <textarea
                    rows={3}
                    value={comments}
                    onChange={(e) => setComments(e.target.value)}
                    placeholder="Enter justification or reason for approval / rejection..."
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                      fontSize: '0.875rem',
                      resize: 'vertical',
                    }}
                  />

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                    <button
                      onClick={() => handleExecuteAction(currentItem.requestId, 'reject')}
                      disabled={actionLoading}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        backgroundColor: '#dc2626',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '0.625rem 1.25rem',
                        fontWeight: 600,
                        fontSize: '0.875rem',
                        cursor: 'pointer',
                      }}
                    >
                      <XCircle size={18} />
                      Reject [R]
                    </button>

                    <button
                      onClick={() => handleExecuteAction(currentItem.requestId, 'approve')}
                      disabled={actionLoading}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        backgroundColor: '#16a34a',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '0.625rem 1.25rem',
                        fontWeight: 600,
                        fontSize: '0.875rem',
                        cursor: 'pointer',
                      }}
                    >
                      <CheckCircle2 size={18} />
                      Approve [A]
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ padding: '4rem 1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              <Filter size={32} style={{ marginBottom: '0.5rem' }} />
              <p style={{ margin: 0 }}>Select a request from the list to review details and take action.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
