import React from 'react';
import Link from 'next/link';
import {
  ShieldCheck,
  ArrowRight,
  Database,
  Lock,
  GitFork,
  ScrollText,
} from 'lucide-react';

export default function HomePage() {
  return (
    <main
      style={{
        display: 'flex',
        minHeight: '100vh',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        padding: '2rem',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Background ambient lighting */}
      <div className="ambient-glow glow-primary" />
      <div className="ambient-glow glow-cyan" />

      <div
        className="glass-panel-elevated"
        style={{
          maxWidth: '720px',
          width: '100%',
          padding: '3rem 2.5rem',
          textAlign: 'center',
          position: 'relative',
          zIndex: 10,
        }}
      >
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '56px',
            height: '56px',
            borderRadius: '16px',
            background: 'linear-gradient(135deg, #6366f1 0%, #38bdf8 100%)',
            color: '#fff',
            boxShadow: '0 8px 24px rgba(99, 102, 241, 0.4)',
            marginBottom: '1.25rem',
          }}
        >
          <ShieldCheck size={32} />
        </div>

        <div style={{ marginBottom: '0.75rem' }}>
          <span
            style={{
              padding: '0.25rem 0.75rem',
              backgroundColor: 'rgba(99, 102, 241, 0.15)',
              color: '#a5b4fc',
              borderRadius: '9999px',
              fontSize: '0.8125rem',
              fontWeight: 600,
              border: '1px solid rgba(99, 102, 241, 0.3)',
            }}
          >
            Sprint 1.1 — Platform Core & RBAC
          </span>
        </div>

        <h1
          style={{
            fontSize: '2.5rem',
            fontWeight: 800,
            letterSpacing: '-0.03em',
            color: '#ffffff',
            marginBottom: '1rem',
          }}
        >
          OrgHub HRMS
        </h1>

        <p
          style={{
            color: 'var(--text-secondary)',
            fontSize: '1.125rem',
            lineHeight: '1.7',
            marginBottom: '2rem',
            maxWidth: '560px',
            margin: '0 auto 2rem',
          }}
        >
          Production-grade, self-hosted HRMS platform engineered with PostgreSQL Row-Level
          Security, composite keys, Argon2id authentication, TOTP MFA, and an append-only audit trail.
        </p>

        {/* Action Buttons */}
        <div
          style={{
            display: 'flex',
            gap: '1rem',
            justifyContent: 'center',
            flexWrap: 'wrap',
            marginBottom: '2.5rem',
          }}
        >
          <Link href="/login" className="btn-primary" style={{ padding: '0.75rem 1.75rem', fontSize: '0.9375rem' }}>
            <span>Sign In to Portal</span>
            <ArrowRight size={18} />
          </Link>

          <Link href="/dashboard" className="btn-secondary" style={{ padding: '0.75rem 1.75rem', fontSize: '0.9375rem' }}>
            <span>Open Dashboard</span>
          </Link>
        </div>

        {/* Feature Badges */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '1rem',
            borderTop: '1px solid var(--border-color)',
            paddingTop: '2rem',
            textAlign: 'left',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <Database size={18} color="var(--primary)" />
            <div>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#fff' }}>PostgreSQL RLS</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Tenant Isolation</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <Lock size={18} color="var(--success)" />
            <div>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#fff' }}>Argon2id + MFA</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>OWASP Compliant</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <GitFork size={18} color="var(--accent)" />
            <div>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#fff' }}>Org Hierarchy</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Cycle Prevention</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <ScrollText size={18} color="var(--warning)" />
            <div>
              <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#fff' }}>Audit Trail</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Append-Only Logs</div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
