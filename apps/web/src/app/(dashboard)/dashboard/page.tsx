'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Users,
  UserPlus,
  Clock,
  FileWarning,
  FileSpreadsheet,
  ShieldCheck,
  ArrowUpRight,
  TrendingUp,
  Database,
  Activity,
  Layers,
} from 'lucide-react';

interface DashboardMetrics {
  headcount: {
    total: number;
    active: number;
    probation: number;
    notice: number;
  };
  newJoinersThisMonth: number;
  pendingChangeRequests: number;
  expiringDocuments: number;
  recentAuditCount: number;
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadMetrics() {
      try {
        const res = await fetch('/api/v1/dashboard/metrics');
        if (res.ok) {
          const json = await res.json();
          setMetrics(json.data);
        } else {
          // Fallback demo state if database is empty
          setMetrics({
            headcount: { total: 0, active: 0, probation: 0, notice: 0 },
            newJoinersThisMonth: 0,
            pendingChangeRequests: 0,
            expiringDocuments: 0,
            recentAuditCount: 0,
          });
        }
      } catch {
        setMetrics({
          headcount: { total: 0, active: 0, probation: 0, notice: 0 },
          newJoinersThisMonth: 0,
          pendingChangeRequests: 0,
          expiringDocuments: 0,
          recentAuditCount: 0,
        });
      } finally {
        setLoading(false);
      }
    }

    loadMetrics();
  }, []);

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <span style={{ fontSize: '0.8125rem', color: '#818cf8', fontWeight: 600 }}>OVERVIEW</span>
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            Workforce Command Center
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Real-time telemetry, headcount analytics, pending approvals, and system observability.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <Link
            href="/employees/import"
            className="btn btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none' }}
          >
            <FileSpreadsheet size={16} />
            <span>Bulk Import</span>
          </Link>
          <Link
            href="/employees"
            className="btn btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none' }}
          >
            <UserPlus size={16} />
            <span>Add Employee</span>
          </Link>
        </div>
      </div>

      {/* Primary KPI Metric Cards Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '1.25rem',
          marginBottom: '2rem',
        }}
      >
        {/* Card 1: Total Headcount */}
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Total Employees</span>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                backgroundColor: 'rgba(99, 102, 241, 0.15)',
                color: 'var(--primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Users size={18} />
            </div>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#fff', marginBottom: '0.25rem' }}>
            {loading ? <div className="skeleton" style={{ height: '32px', width: '80px' }} /> : metrics?.headcount.total}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <span style={{ color: 'var(--success)' }}>{metrics?.headcount.active ?? 0} active</span>
            <span>•</span>
            <span style={{ color: 'var(--warning)' }}>{metrics?.headcount.probation ?? 0} probation</span>
            <span>•</span>
            <span style={{ color: 'var(--danger)' }}>{metrics?.headcount.notice ?? 0} notice</span>
          </div>
        </div>

        {/* Card 2: New Joiners This Month */}
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Joiners This Month</span>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                color: 'var(--success)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <TrendingUp size={18} />
            </div>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#fff', marginBottom: '0.25rem' }}>
            {loading ? <div className="skeleton" style={{ height: '32px', width: '60px' }} /> : metrics?.newJoinersThisMonth}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <Link href="/employees" style={{ color: 'var(--success)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <span>View workforce roster</span>
              <ArrowUpRight size={12} />
            </Link>
          </div>
        </div>

        {/* Card 3: Pending Approvals */}
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Pending Changes</span>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                backgroundColor: 'rgba(245, 158, 11, 0.15)',
                color: 'var(--warning)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Clock size={18} />
            </div>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#fff', marginBottom: '0.25rem' }}>
            {loading ? <div className="skeleton" style={{ height: '32px', width: '60px' }} /> : metrics?.pendingChangeRequests}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <Link href="/admin/change-requests" style={{ color: 'var(--warning)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              <span>Review pending requests</span>
              <ArrowUpRight size={12} />
            </Link>
          </div>
        </div>

        {/* Card 4: Expiring Documents */}
        <div className="glass-panel" style={{ padding: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Document Expiries</span>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                color: 'var(--danger)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <FileWarning size={18} />
            </div>
          </div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#fff', marginBottom: '0.25rem' }}>
            {loading ? <div className="skeleton" style={{ height: '32px', width: '60px' }} /> : metrics?.expiringDocuments}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            <span style={{ color: metrics?.expiringDocuments ? 'var(--danger)' : 'var(--text-muted)' }}>
              Next 30 days
            </span>
          </div>
        </div>
      </div>

      {/* Grid: Quick Actions & System Health */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '1.5rem' }}>
        {/* Quick Operations */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', marginBottom: '0.25rem' }}>
            Operational Actions
          </h2>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
            Direct administrative and bulk operations.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <Link
              href="/employees/import"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.875rem 1rem',
                backgroundColor: 'rgba(30, 41, 59, 0.6)',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                textDecoration: 'none',
                color: 'var(--text-primary)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <FileSpreadsheet size={18} color="var(--primary)" />
                <div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>Bulk Import & Upsert</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>CSV/XLSX validation preview & batched transaction</div>
                </div>
              </div>
              <ArrowUpRight size={16} color="var(--text-muted)" />
            </Link>

            <Link
              href="/admin/custom-fields"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.875rem 1rem',
                backgroundColor: 'rgba(30, 41, 59, 0.6)',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                textDecoration: 'none',
                color: 'var(--text-primary)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Layers size={18} color="var(--accent)" />
                <div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>Custom Fields Builder</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Configure dynamic fields, types & validation</div>
                </div>
              </div>
              <ArrowUpRight size={16} color="var(--text-muted)" />
            </Link>

            <Link
              href="/audit-logs"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.875rem 1rem',
                backgroundColor: 'rgba(30, 41, 59, 0.6)',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                textDecoration: 'none',
                color: 'var(--text-primary)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <ShieldCheck size={18} color="var(--success)" />
                <div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>Audit Trail & Security</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{metrics?.recentAuditCount ?? 0} events in last 24h</div>
                </div>
              </div>
              <ArrowUpRight size={16} color="var(--text-muted)" />
            </Link>
          </div>
        </div>

        {/* Observability & Telemetry */}
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', marginBottom: '0.25rem' }}>
            Observability & Telemetry
          </h2>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
            Prometheus metrics and infrastructure health.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div
              style={{
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                backgroundColor: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Database size={18} color="var(--success)" />
                <div>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#fff' }}>PostgreSQL Pool (App & Worker)</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Transaction-mode pooled with forced RLS</div>
                </div>
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600 }}>Connected</span>
            </div>

            <div
              style={{
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                backgroundColor: 'rgba(99, 102, 241, 0.08)',
                border: '1px solid rgba(99, 102, 241, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <Activity size={18} color="var(--primary)" />
                <div>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#fff' }}>Prometheus Telemetry</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Latencies, pool stats & query metrics</div>
                </div>
              </div>
              <a
                href="/api/metrics"
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}
              >
                /api/metrics
              </a>
            </div>

            <div
              style={{
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                backgroundColor: 'rgba(56, 189, 248, 0.08)',
                border: '1px solid rgba(56, 189, 248, 0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <ShieldCheck size={18} color="var(--accent)" />
                <div>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#fff' }}>Security Headers & CSP</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>HSTS, nosniff, frame-ancestors none</div>
                </div>
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 600 }}>Enforced</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
