'use client';

import React, { useEffect, useState } from 'react';
import {
  ScrollText,
  Search,
  Filter,
  ChevronRight,
  ChevronDown,
  Clock,
  Shield,
  RefreshCw,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';

interface AuditLogItem {
  id: string;
  ts: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
}

interface AuditCursor {
  ts: string;
  id: string;
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [nextCursor, setNextCursor] = useState<AuditCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Filters - default to current month for partition pruning
  const now = new Date();
  const firstDayOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .split('T')[0];
  const todayStr = now.toISOString().split('T')[0];

  const [startDate, setStartDate] = useState(firstDayOfMonth);
  const [endDate, setEndDate] = useState(todayStr);
  const [actionFilter, setActionFilter] = useState('');
  const [entityFilter, setEntityFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');

  const fetchLogs = async (cursor?: AuditCursor) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set('limit', '25');
      if (cursor) {
        params.set('cursorTs', cursor.ts);
        params.set('cursorId', cursor.id);
      }
      if (startDate) params.set('startDate', `${startDate}T00:00:00Z`);
      if (endDate) params.set('endDate', `${endDate}T23:59:59Z`);
      if (actionFilter) params.set('action', actionFilter);
      if (entityFilter) params.set('entity', entityFilter);
      if (actorFilter) params.set('actorId', actorFilter);

      const res = await fetch(`/api/v1/audit-logs?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || data.items || []);
        setNextCursor(data.nextCursor || null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [actionFilter, entityFilter, actorFilter, startDate, endDate]);

  const toggleRow = (id: string) => {
    setExpandedRow(expandedRow === id ? null : id);
  };

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: '1.75rem',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <ScrollText size={16} color="var(--success)" />
            <span style={{ fontSize: '0.8125rem', color: 'var(--success)', fontWeight: 600 }}>COMPLIANCE & GOVERNANCE</span>
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            Append-Only Audit Trail
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Tamper-evident, monthly partitioned PostgreSQL event logs tracking mutations across tenant data.
          </p>
        </div>

        <button
          type="button"
          onClick={() => fetchLogs()}
          disabled={loading}
          className="btn-secondary"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Filter Bar with Partition Pruning Date Range */}
      <div
        style={{
          display: 'flex',
          gap: '0.75rem',
          alignItems: 'center',
          marginBottom: '1.25rem',
          flexWrap: 'wrap',
          backgroundColor: 'rgba(15, 23, 42, 0.4)',
          padding: '0.875rem 1rem',
          borderRadius: '8px',
          border: '1px solid var(--border-color)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>From:</span>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="form-input"
            style={{ fontSize: '0.8125rem', padding: '0.35rem 0.5rem', width: '135px' }}
            title="Partition pruning start date"
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>To:</span>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="form-input"
            style={{ fontSize: '0.8125rem', padding: '0.35rem 0.5rem', width: '135px' }}
            title="Partition pruning end date"
          />
        </div>

        <div style={{ position: 'relative', width: '200px' }}>
          <Filter
            size={14}
            style={{
              position: 'absolute',
              left: '0.75rem',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
            }}
          />
          <input
            type="text"
            value={entityFilter}
            onChange={e => setEntityFilter(e.target.value)}
            placeholder="Entity (e.g. employee)"
            className="form-input"
            style={{ paddingLeft: '2.1rem', fontSize: '0.8125rem', padding: '0.35rem 0.5rem 0.35rem 2.1rem' }}
          />
        </div>

        <div style={{ position: 'relative', width: '170px' }}>
          <Search
            size={14}
            style={{
              position: 'absolute',
              left: '0.75rem',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)',
            }}
          />
          <input
            type="text"
            value={actionFilter}
            onChange={e => setActionFilter(e.target.value)}
            placeholder="Action (create/update)"
            className="form-input"
            style={{ paddingLeft: '2.1rem', fontSize: '0.8125rem', padding: '0.35rem 0.5rem 0.35rem 2.1rem' }}
          />
        </div>

        <div style={{ position: 'relative', width: '180px' }}>
          <input
            type="text"
            value={actorFilter}
            onChange={e => setActorFilter(e.target.value)}
            placeholder="Actor UUID"
            className="form-input"
            style={{ fontSize: '0.8125rem', padding: '0.35rem 0.5rem' }}
          />
        </div>
      </div>

      {/* Logs Table */}
      {loading ? (
        <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          Retrieving audit records...
        </div>
      ) : logs.length === 0 ? (
        <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          No audit entries recorded for the current filter criteria.
        </div>
      ) : (
        <div className="glass-panel" style={{ overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.8125rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(15, 23, 42, 0.5)' }}>
                <th style={{ width: '40px', padding: '0.75rem 1rem' }} />
                <th style={{ padding: '0.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                  Timestamp (UTC)
                </th>
                <th style={{ padding: '0.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                  Action
                </th>
                <th style={{ padding: '0.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                  Entity
                </th>
                <th style={{ padding: '0.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                  Actor Role
                </th>
                <th style={{ padding: '0.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                  IP Address
                </th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => {
                const isExpanded = expandedRow === log.id;
                return (
                  <React.Fragment key={log.id}>
                    <tr
                      onClick={() => toggleRow(log.id)}
                      style={{
                        borderBottom: '1px solid var(--border-color)',
                        cursor: 'pointer',
                        backgroundColor: isExpanded ? 'rgba(30, 41, 59, 0.4)' : 'transparent',
                        transition: 'background-color 0.15s ease',
                      }}
                    >
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                          <Clock size={13} color="var(--text-muted)" />
                          <span>{new Date(log.ts).toLocaleString()}</span>
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <span
                          style={{
                            padding: '0.15rem 0.45rem',
                            borderRadius: '4px',
                            backgroundColor:
                              log.action.includes('create') || log.action.includes('login')
                                ? 'rgba(16, 185, 129, 0.15)'
                                : log.action.includes('delete')
                                  ? 'rgba(239, 68, 68, 0.15)'
                                  : 'rgba(99, 102, 241, 0.15)',
                            color:
                              log.action.includes('create') || log.action.includes('login')
                                ? '#6ee7b7'
                                : log.action.includes('delete')
                                  ? '#fca5a5'
                                  : '#a5b4fc',
                            fontWeight: 600,
                            fontFamily: 'monospace',
                            fontSize: '0.75rem',
                          }}
                        >
                          {log.action}
                        </span>
                      </td>
                      <td style={{ padding: '0.75rem 1rem', color: '#fff', fontWeight: 500 }}>
                        {log.entity}
                      </td>
                      <td style={{ padding: '0.75rem 1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                          <Shield size={13} color="var(--primary)" />
                          <span style={{ color: 'var(--text-secondary)' }}>{log.actorRole || 'System'}</span>
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem 1rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                        {log.ip || '127.0.0.1'}
                      </td>
                    </tr>

                    {/* Expandable JSON Before/After Diff Inspector */}
                    {isExpanded && (
                      <tr style={{ backgroundColor: 'rgba(15, 23, 42, 0.8)', borderBottom: '1px solid var(--border-color)' }}>
                        <td colSpan={6} style={{ padding: '1.25rem 1.75rem' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                            {/* Before State */}
                            <div>
                              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#f87171', marginBottom: '0.5rem' }}>
                                State Before Modification:
                              </div>
                              <pre
                                style={{
                                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                                  border: '1px solid rgba(239, 68, 68, 0.2)',
                                  borderRadius: '6px',
                                  padding: '0.75rem',
                                  fontSize: '0.75rem',
                                  color: '#cbd5e1',
                                  overflowX: 'auto',
                                  maxHeight: '220px',
                                  fontFamily: 'monospace',
                                }}
                              >
                                {log.before ? JSON.stringify(log.before, null, 2) : '(none / creation event)'}
                              </pre>
                            </div>

                            {/* After State */}
                            <div>
                              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#4ade80', marginBottom: '0.5rem' }}>
                                State After Modification:
                              </div>
                              <pre
                                style={{
                                  backgroundColor: 'rgba(0, 0, 0, 0.5)',
                                  border: '1px solid rgba(34, 197, 94, 0.2)',
                                  borderRadius: '6px',
                                  padding: '0.75rem',
                                  fontSize: '0.75rem',
                                  color: '#cbd5e1',
                                  overflowX: 'auto',
                                  maxHeight: '220px',
                                  fontFamily: 'monospace',
                                }}
                              >
                                {log.after ? JSON.stringify(log.after, null, 2) : '(none / deletion event)'}
                              </pre>
                            </div>
                          </div>

                          <div style={{ marginTop: '0.75rem', fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                            Logged for Record ID: <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{log.entityId || 'N/A'}</span> • Audit Event ID: <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{log.id}</span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>

          {/* Keyset Cursor Pagination Controls */}
          <div
            style={{
              padding: '0.875rem 1.25rem',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: 'rgba(15, 23, 42, 0.4)',
            }}
          >
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Showing {logs.length} events
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => fetchLogs()}
                className="btn-secondary"
                style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
              >
                <ArrowLeft size={13} />
                <span>First Page</span>
              </button>
              {nextCursor && (
                <button
                  type="button"
                  onClick={() => fetchLogs(nextCursor)}
                  className="btn-primary"
                  style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem' }}
                >
                  <span>Next Page</span>
                  <ArrowRight size={13} />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
