import React from 'react';

export default function HomePage() {
  return (
    <main
      style={{
        display: 'flex',
        minHeight: '100vh',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#0a0f1d',
        color: '#f8fafc',
        padding: '2rem',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          maxWidth: '640px',
          padding: '2.5rem',
          backgroundColor: '#111827',
          borderRadius: '16px',
          border: '1px solid #1f2937',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            padding: '0.25rem 0.75rem',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            color: '#60a5fa',
            borderRadius: '9999px',
            fontSize: '0.875rem',
            fontWeight: 600,
            marginBottom: '1rem',
          }}
        >
          Sprint 0 — Platform Foundation
        </span>
        <h1 style={{ fontSize: '2.25rem', fontWeight: 800, margin: '0 0 1rem 0' }}>
          OrgHub HRMS
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '1.125rem', lineHeight: '1.75' }}>
          Production-grade, self-hosted HRMS platform engineered with PostgreSQL Row-Level
          Security, composite keys, and strict tenant isolation.
        </p>
        <div
          style={{
            display: 'flex',
            gap: '1rem',
            justifyContent: 'center',
            marginTop: '2rem',
          }}
        >
          <a
            href="/api/health"
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: '#2563eb',
              color: '#ffffff',
              borderRadius: '8px',
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            Check Health (Liveness)
          </a>
          <a
            href="/api/ready"
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: '#1e293b',
              color: '#f8fafc',
              borderRadius: '8px',
              textDecoration: 'none',
              fontWeight: 600,
              border: '1px solid #334155',
            }}
          >
            Check Readiness
          </a>
        </div>
      </div>
    </main>
  );
}
