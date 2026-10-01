import React from 'react';
import { ShieldCheck, Lock, Database } from 'lucide-react';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg-primary)',
        position: 'relative',
        overflow: 'hidden',
        padding: '1.5rem',
      }}
    >
      {/* Ambient background glows */}
      <div className="ambient-glow glow-primary" />
      <div className="ambient-glow glow-cyan" />

      {/* Main Form Container */}
      <div
        style={{
          width: '100%',
          maxWidth: '440px',
          position: 'relative',
          zIndex: 10,
        }}
      >
        {/* Brand Banner */}
        <div
          style={{
            textAlign: 'center',
            marginBottom: '1.75rem',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '48px',
              height: '48px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #6366f1 0%, #38bdf8 100%)',
              color: '#ffffff',
              boxShadow: '0 8px 24px rgba(99, 102, 241, 0.35)',
              marginBottom: '0.75rem',
            }}
          >
            <ShieldCheck size={28} />
          </div>
          <h1
            style={{
              fontSize: '1.5rem',
              fontWeight: 800,
              color: '#ffffff',
              letterSpacing: '-0.02em',
              marginBottom: '0.25rem',
            }}
          >
            OrgHub HRMS
          </h1>
          <p
            style={{
              fontSize: '0.875rem',
              color: 'var(--text-secondary)',
            }}
          >
            Enterprise Human Resource Management System
          </p>
        </div>

        {/* Card Body */}
        <div className="glass-panel-elevated" style={{ padding: '2rem' }}>
          {children}
        </div>

        {/* Security Trust Badges */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1.25rem',
            marginTop: '1.5rem',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <Database size={13} color="var(--primary)" />
            <span>PostgreSQL RLS</span>
          </div>
          <span>•</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <Lock size={13} color="var(--success)" />
            <span>Argon2id + AES-256</span>
          </div>
        </div>
      </div>
    </div>
  );
}
