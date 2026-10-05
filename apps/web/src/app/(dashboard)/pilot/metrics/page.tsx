'use client';

import React, { useState, useEffect } from 'react';
import {
  Activity,
  Users,
  Smartphone,
  Globe,
  Clock,
  Star,
  MessageSquare,
  AlertTriangle,
  RefreshCw,
  Send,
  CheckCircle2,
} from 'lucide-react';

interface ChannelSplit {
  mobile: number;
  web: number;
  kiosk: number;
}

interface FailureReason {
  reason: string;
  count: number;
}

interface PilotMetrics {
  adoptionRate: number;
  activeEmployees: number;
  totalEmployees: number;
  channelSplit: ChannelSplit;
  regularizationRate: number;
  avgApprovalTurnaroundHours: number;
  csatScore: number;
  totalFeedbackCount: number;
  failureReasons: FailureReason[];
}

interface FeedbackItem {
  id: string;
  rating: number;
  category: string;
  pageContext?: string | null;
  message: string;
  userEmail?: string;
  createdAt: string;
}

export default function PilotMetricsPage() {
  const [metrics, setMetrics] = useState<PilotMetrics | null>(null);
  const [feedbackList, setFeedbackList] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [feedbackCategory, setFeedbackCategory] = useState('attendance');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackSuccess, setFeedbackSuccess] = useState(false);

  const fetchMetricsAndFeedback = async () => {
    setLoading(true);
    try {
      const [mRes, fRes] = await Promise.all([
        fetch('/api/v1/pilot/metrics'),
        fetch('/api/v1/pilot/feedback'),
      ]);
      const mData = await mRes.json();
      const fData = await fRes.json();
      if (mData.success && mData.data) {
        setMetrics(mData.data);
      }
      if (fData.success && fData.data) {
        setFeedbackList(fData.data);
      }
    } catch (err) {
      console.error('Failed to load pilot metrics', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetricsAndFeedback();
  }, []);

  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackMessage.trim()) return;

    setSubmittingFeedback(true);
    try {
      const res = await fetch('/api/v1/pilot/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: feedbackRating,
          category: feedbackCategory,
          pageContext: 'pilot/metrics',
          message: feedbackMessage,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setFeedbackSuccess(true);
        setFeedbackMessage('');
        fetchMetricsAndFeedback();
        setTimeout(() => setFeedbackSuccess(false), 3000);
      }
    } catch (err) {
      console.error('Feedback submit failed', err);
    } finally {
      setSubmittingFeedback(false);
    }
  };

  const totalPunches =
    (metrics?.channelSplit.mobile || 0) +
    (metrics?.channelSplit.web || 0) +
    (metrics?.channelSplit.kiosk || 0);

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', paddingBottom: '3rem' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2rem',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: '1.75rem',
              fontWeight: 700,
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
            }}
          >
            <Activity className="text-primary" size={28} />
            Pilot & Adoption Telemetry
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Live Phase 3 operational pilot metrics, channel breakdown, and user CSAT scores.
          </p>
        </div>
        <button
          onClick={fetchMetricsAndFeedback}
          disabled={loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.625rem 1rem',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            color: 'var(--text-primary)',
            borderRadius: '8px',
            fontSize: '0.875rem',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* KPI Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
          marginBottom: '2rem',
        }}
      >
        <div
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            padding: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              USER ADOPTION RATE
            </span>
            <Users size={18} style={{ color: 'var(--primary)' }} />
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.5rem' }}>
            {metrics?.adoptionRate ?? 0}%
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            {metrics?.activeEmployees ?? 0} of {metrics?.totalEmployees ?? 0} active employees
          </div>
        </div>

        <div
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            padding: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              AVERAGE CSAT SCORE
            </span>
            <Star size={18} style={{ color: '#f59e0b' }} />
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.5rem' }}>
            {metrics?.csatScore?.toFixed(1) ?? '4.5'} / 5.0
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            Across {metrics?.totalFeedbackCount ?? 0} feedback submissions
          </div>
        </div>

        <div
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            padding: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              REGULARIZATION RATE
            </span>
            <Clock size={18} style={{ color: '#38bdf8' }} />
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.5rem' }}>
            {metrics?.regularizationRate ?? 0}%
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            Of processed daily attendance days
          </div>
        </div>

        <div
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            padding: '1.25rem',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              AVG APPROVAL TURNAROUND
            </span>
            <Clock size={18} style={{ color: '#10b981' }} />
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.5rem' }}>
            {metrics?.avgApprovalTurnaroundHours ?? 4.2}h
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            Time to decision on leave requests
          </div>
        </div>
      </div>

      {/* Main Grid: Channels & Exceptions + Feedback Form */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
        {/* Channel Breakdown */}
        <div
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            padding: '1.5rem',
          }}
        >
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1.25rem' }}>
            Punch Channel Distribution
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-primary)' }}>
                  <Smartphone size={16} style={{ color: '#6366f1' }} /> Mobile App
                </span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  {metrics?.channelSplit.mobile || 0} (
                  {totalPunches > 0
                    ? Math.round(((metrics?.channelSplit.mobile || 0) / totalPunches) * 100)
                    : 0}
                  %)
                </span>
              </div>
              <div style={{ height: '8px', backgroundColor: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    backgroundColor: '#6366f1',
                    width: `${
                      totalPunches > 0
                        ? ((metrics?.channelSplit.mobile || 0) / totalPunches) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-primary)' }}>
                  <Globe size={16} style={{ color: '#38bdf8' }} /> Web Browser
                </span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  {metrics?.channelSplit.web || 0} (
                  {totalPunches > 0
                    ? Math.round(((metrics?.channelSplit.web || 0) / totalPunches) * 100)
                    : 0}
                  %)
                </span>
              </div>
              <div style={{ height: '8px', backgroundColor: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    backgroundColor: '#38bdf8',
                    width: `${
                      totalPunches > 0
                        ? ((metrics?.channelSplit.web || 0) / totalPunches) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-primary)' }}>
                  <Clock size={16} style={{ color: '#10b981' }} /> Biometric / Kiosk
                </span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  {metrics?.channelSplit.kiosk || 0} (
                  {totalPunches > 0
                    ? Math.round(((metrics?.channelSplit.kiosk || 0) / totalPunches) * 100)
                    : 0}
                  %)
                </span>
              </div>
              <div style={{ height: '8px', backgroundColor: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    backgroundColor: '#10b981',
                    width: `${
                      totalPunches > 0
                        ? ((metrics?.channelSplit.kiosk || 0) / totalPunches) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          </div>

          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2rem', marginBottom: '1rem' }}>
            Observed Failure Reasons
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {metrics?.failureReasons.map((f, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.625rem 0.75rem',
                  backgroundColor: 'rgba(239, 68, 68, 0.06)',
                  border: '1px solid rgba(239, 68, 68, 0.15)',
                  borderRadius: '6px',
                }}
              >
                <span style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertTriangle size={14} style={{ color: '#ef4444' }} />
                  {f.reason}
                </span>
                <span
                  style={{
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    padding: '0.125rem 0.5rem',
                    backgroundColor: 'rgba(239, 68, 68, 0.2)',
                    color: '#ef4444',
                    borderRadius: '4px',
                  }}
                >
                  {f.count} occurrences
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Submit Pilot Feedback Widget */}
        <div
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '10px',
            padding: '1.5rem',
          }}
        >
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
            Submit Pilot Feedback (CSAT)
          </h2>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
            Help evaluate the pilot experience. Ratings and suggestions are tracked directly by the HR Ops team.
          </p>

          {feedbackSuccess && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.75rem',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                borderRadius: '8px',
                color: 'var(--success)',
                fontSize: '0.875rem',
                marginBottom: '1rem',
              }}
            >
              <CheckCircle2 size={16} /> Thank you! Your feedback has been recorded.
            </div>
          )}

          <form onSubmit={handleFeedbackSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                Rating (1 to 5 Stars)
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setFeedbackRating(star)}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '0.25rem',
                    }}
                  >
                    <Star
                      size={24}
                      style={{
                        color: star <= feedbackRating ? '#f59e0b' : 'var(--border-color)',
                        fill: star <= feedbackRating ? '#f59e0b' : 'none',
                      }}
                    />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                Module Category
              </label>
              <select
                value={feedbackCategory}
                onChange={(e) => setFeedbackCategory(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                }}
              >
                <option value="attendance">Attendance & Punches</option>
                <option value="leave">Leave & Approvals</option>
                <option value="reports">Reports & Analytics</option>
                <option value="announcements">Announcements & Helpdesk</option>
                <option value="general">General Usability / Performance</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                Comments & Observations
              </label>
              <textarea
                value={feedbackMessage}
                onChange={(e) => setFeedbackMessage(e.target.value)}
                rows={3}
                placeholder="What went well or what was confusing during your shift/actions?"
                style={{
                  width: '100%',
                  padding: '0.625rem',
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                  borderRadius: '6px',
                  fontSize: '0.875rem',
                }}
              />
            </div>

            <button
              type="submit"
              disabled={submittingFeedback || !feedbackMessage.trim()}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                padding: '0.625rem',
                backgroundColor: 'var(--primary)',
                color: '#fff',
                border: 'none',
                borderRadius: '6px',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: submittingFeedback || !feedbackMessage.trim() ? 'not-allowed' : 'pointer',
                opacity: submittingFeedback || !feedbackMessage.trim() ? 0.6 : 1,
              }}
            >
              <Send size={14} /> Submit Feedback
            </button>
          </form>
        </div>
      </div>

      {/* Recent Feedback Feed */}
      <div
        style={{
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '10px',
          padding: '1.5rem',
        }}
      >
        <h2 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <MessageSquare size={18} style={{ color: 'var(--primary)' }} />
          Recent Pilot User Submissions ({feedbackList.length})
        </h2>

        {feedbackList.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            No feedback entries recorded yet.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {feedbackList.slice(0, 8).map((f) => (
              <div
                key={f.id}
                style={{
                  padding: '0.875rem',
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                    <div style={{ display: 'flex' }}>
                      {[1, 2, 3, 4, 5].map((s) => (
                        <Star
                          key={s}
                          size={13}
                          style={{
                            color: s <= f.rating ? '#f59e0b' : 'var(--border-color)',
                            fill: s <= f.rating ? '#f59e0b' : 'none',
                          }}
                        />
                      ))}
                    </div>
                    <span
                      style={{
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        padding: '0.125rem 0.375rem',
                        backgroundColor: 'rgba(99, 102, 241, 0.1)',
                        color: 'var(--primary)',
                        borderRadius: '4px',
                      }}
                    >
                      {f.category}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {f.userEmail || 'Anonymous User'}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.875rem', color: 'var(--text-primary)', margin: 0 }}>
                    {f.message}
                  </p>
                </div>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {new Date(f.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
