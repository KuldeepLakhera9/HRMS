'use client';

import React, { useEffect, useState } from 'react';
import {
  Smartphone,
  Laptop,
  Trash2,
  RefreshCw,
  Lock,
  KeyRound,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

interface SessionItem {
  id: string;
  ip?: string;
  userAgent?: string;
  clientType: string;
  deviceLabel?: string;
  mfaVerifiedAt?: string;
  stepUpUntil?: string;
  lastSeenAt: string;
  createdAt: string;
  isCurrent: boolean;
}

export default function SecuritySessionsPage() {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Step-up dialog
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpPassword, setStepUpPassword] = useState('');
  const [stepUpTotp, setStepUpTotp] = useState('');
  const [stepUpSubmitting, setStepUpSubmitting] = useState(false);

  const fetchSessions = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/v1/auth/sessions');
      if (res.ok) {
        const body = await res.json();
        setSessions(body.data || []);
      } else {
        const err = await res.json();
        setError(err.error?.message || 'Failed to load active sessions.');
      }
    } catch {
      setError('Network error while fetching sessions.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  const handleRevoke = async (id: string) => {
    if (!confirm('Are you sure you want to terminate this session?')) return;
    try {
      setActionLoading(id);
      setError(null);
      const res = await fetch(`/api/v1/auth/sessions/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setSuccessMsg('Session terminated successfully.');
        setTimeout(() => setSuccessMsg(null), 3000);
        await fetchSessions();
      } else {
        const err = await res.json();
        setError(err.error?.message || 'Failed to terminate session.');
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleStepUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setStepUpSubmitting(true);
      setError(null);
      const res = await fetch('/api/v1/auth/step-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: stepUpPassword || undefined,
          totpCode: stepUpTotp || undefined,
        }),
      });

      if (res.ok) {
        setSuccessMsg('Step-up verification active for 10 minutes.');
        setStepUpOpen(false);
        setStepUpPassword('');
        setStepUpTotp('');
        setTimeout(() => setSuccessMsg(null), 4000);
        await fetchSessions();
      } else {
        const err = await res.json();
        setError(err.error?.message || 'Step-up verification failed.');
      }
    } finally {
      setStepUpSubmitting(false);
    }
  };

  const currentSession = sessions.find(s => s.isCurrent);
  const isStepUpActive = Boolean(
    currentSession?.stepUpUntil && new Date(currentSession.stepUpUntil).getTime() > Date.now(),
  );

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
            Security & Active Sessions
          </h1>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            Manage signed-in devices, session timeouts, and elevated authorization.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={() => setStepUpOpen(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              backgroundColor: isStepUpActive ? 'rgba(16, 185, 129, 0.15)' : 'var(--primary)',
              color: isStepUpActive ? 'var(--success)' : '#fff',
              border: isStepUpActive ? '1px solid var(--success)' : 'none',
              borderRadius: '8px',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <KeyRound size={16} />
            {isStepUpActive ? 'Step-Up Active' : 'Elevate Privileges'}
          </button>
          <button
            onClick={fetchSessions}
            disabled={loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 0.75rem',
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div
          style={{
            padding: '0.875rem 1rem',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '8px',
            color: 'var(--danger)',
            fontSize: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div
          style={{
            padding: '0.875rem 1rem',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            borderRadius: '8px',
            color: 'var(--success)',
            fontSize: '0.875rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <CheckCircle2 size={18} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Step-up modal */}
      {stepUpOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              padding: '1.75rem',
              width: '100%',
              maxWidth: '420px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(99, 102, 241, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--primary)',
                }}
              >
                <Lock size={20} />
              </div>
              <div>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Step-Up Authentication
                </h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Confirm your identity to unlock sensitive actions for 10 minutes.
                </p>
              </div>
            </div>

            <form onSubmit={handleStepUpSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, marginBottom: '0.375rem' }}>
                  Current Password
                </label>
                <input
                  type="password"
                  value={stepUpPassword}
                  onChange={e => setStepUpPassword(e.target.value)}
                  placeholder="Enter your current password"
                  style={{
                    width: '100%',
                    padding: '0.625rem 0.875rem',
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    color: 'var(--text-primary)',
                    fontSize: '0.875rem',
                  }}
                />
              </div>

              <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>— OR —</div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 500, marginBottom: '0.375rem' }}>
                  Authenticator TOTP Code
                </label>
                <input
                  type="text"
                  value={stepUpTotp}
                  onChange={e => setStepUpTotp(e.target.value)}
                  placeholder="6-digit TOTP code"
                  maxLength={6}
                  style={{
                    width: '100%',
                    padding: '0.625rem 0.875rem',
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    color: 'var(--text-primary)',
                    fontSize: '0.875rem',
                    letterSpacing: '0.2em',
                    textAlign: 'center',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setStepUpOpen(false)}
                  style={{
                    flex: 1,
                    padding: '0.625rem',
                    backgroundColor: 'transparent',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    color: 'var(--text-secondary)',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={stepUpSubmitting || (!stepUpPassword && !stepUpTotp)}
                  style={{
                    flex: 1,
                    padding: '0.625rem',
                    backgroundColor: 'var(--primary)',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#fff',
                    fontWeight: 600,
                    cursor: 'pointer',
                    opacity: stepUpSubmitting ? 0.6 : 1,
                  }}
                >
                  {stepUpSubmitting ? 'Verifying...' : 'Verify Identity'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Active Sessions List */}
      <div
        style={{
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--border-color)' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
            Active Devices & Sessions ({sessions.length})
          </h2>
        </div>

        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            <RefreshCw className="animate-spin" size={24} style={{ margin: '0 auto 0.5rem' }} />
            Loading active sessions...
          </div>
        ) : sessions.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            No active sessions found.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {sessions.map(s => {
              const isMobile = s.clientType === 'mobile';
              const Icon = isMobile ? Smartphone : Laptop;

              return (
                <div
                  key={s.id}
                  style={{
                    padding: '1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottom: '1px solid var(--border-color)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div
                      style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '10px',
                        backgroundColor: s.isCurrent ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                        color: s.isCurrent ? 'var(--primary)' : 'var(--text-secondary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Icon size={22} />
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontWeight: 600, fontSize: '0.9375rem', color: 'var(--text-primary)' }}>
                          {s.deviceLabel || s.clientType.toUpperCase()}
                        </span>
                        {s.isCurrent && (
                          <span
                            style={{
                              fontSize: '0.6875rem',
                              fontWeight: 600,
                              padding: '0.125rem 0.5rem',
                              borderRadius: '4px',
                              backgroundColor: 'rgba(16, 185, 129, 0.15)',
                              color: 'var(--success)',
                            }}
                          >
                            Current Session
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.125rem' }}>
                        <span>IP: {s.ip || 'Unknown'}</span>
                        <span style={{ margin: '0 0.5rem' }}>•</span>
                        <span>Last active: {new Date(s.lastSeenAt).toLocaleString()}</span>
                      </div>
                      {s.userAgent && (
                        <div
                          style={{
                            fontSize: '0.75rem',
                            color: 'var(--text-secondary)',
                            marginTop: '0.25rem',
                            maxWidth: '500px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {s.userAgent}
                        </div>
                      )}
                    </div>
                  </div>

                  {!s.isCurrent && (
                    <button
                      onClick={() => handleRevoke(s.id)}
                      disabled={actionLoading === s.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.375rem',
                        padding: '0.4rem 0.75rem',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        color: 'var(--danger)',
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                        borderRadius: '6px',
                        fontSize: '0.8125rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      <Trash2 size={14} />
                      {actionLoading === s.id ? 'Revoking...' : 'Terminate'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
