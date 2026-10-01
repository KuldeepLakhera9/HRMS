'use client';

import React, { useEffect, useState } from 'react';
import {
  Briefcase,
  Plus,
  Search,
  CheckCircle,
  XCircle,
  X,
  AlertCircle,
} from 'lucide-react';

interface Designation {
  id: string;
  name: string;
  code: string;
  active: boolean;
}

export default function DesignationsPage() {
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  // New Designation Form State
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadDesignations = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/v1/org/designations');
      if (res.ok) {
        const data = await res.json();
        setDesignations(data.designations || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDesignations();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setFormError(null);

    try {
      const res = await fetch('/api/v1/org/designations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          code: code.toUpperCase(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error?.message || 'Failed to create designation.');
      } else {
        setName('');
        setCode('');
        setDialogOpen(false);
        loadDesignations();
      }
    } catch {
      setFormError('Network error occurred.');
    } finally {
      setCreating(false);
    }
  };

  const filtered = designations.filter(
    d =>
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.code.toLowerCase().includes(search.toLowerCase()),
  );

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
            <Briefcase size={16} color="var(--accent)" />
            <span style={{ fontSize: '0.8125rem', color: 'var(--accent)', fontWeight: 600 }}>ORGANIZATION</span>
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            Designations & Job Titles
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Define company job roles, functional titles, and professional hierarchy.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="btn-primary"
        >
          <Plus size={16} />
          <span>New Designation</span>
        </button>
      </div>

      {/* Control Bar: Search */}
      <div style={{ position: 'relative', width: '320px', marginBottom: '1.25rem' }}>
        <Search
          size={16}
          style={{
            position: 'absolute',
            left: '0.875rem',
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-muted)',
          }}
        />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by job title or code..."
          className="form-input"
          style={{ paddingLeft: '2.5rem' }}
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading designations...
        </div>
      ) : (
        <div className="glass-panel" style={{ overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(15, 23, 42, 0.5)' }}>
                <th style={{ padding: '0.875rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>
                  Designation Title
                </th>
                <th style={{ padding: '0.875rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>
                  Code
                </th>
                <th style={{ padding: '0.875rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No designations found.
                  </td>
                </tr>
              ) : (
                filtered.map(d => (
                  <tr key={d.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '0.875rem 1.25rem', color: '#fff', fontWeight: 600 }}>
                      {d.name}
                    </td>
                    <td style={{ padding: '0.875rem 1.25rem' }}>
                      <span
                        style={{
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(56, 189, 248, 0.1)',
                          color: 'var(--accent)',
                          fontSize: '0.75rem',
                          fontFamily: 'monospace',
                          fontWeight: 600,
                        }}
                      >
                        {d.code}
                      </span>
                    </td>
                    <td style={{ padding: '0.875rem 1.25rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.75rem' }}>
                        {d.active ? (
                          <>
                            <CheckCircle size={14} color="var(--success)" />
                            <span style={{ color: 'var(--success)' }}>Active</span>
                          </>
                        ) : (
                          <>
                            <XCircle size={14} color="var(--danger)" />
                            <span style={{ color: 'var(--danger)' }}>Inactive</span>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Dialog: Add Designation */}
      {dialogOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '1rem',
          }}
        >
          <div
            className="glass-panel-elevated"
            style={{ width: '100%', maxWidth: '440px', padding: '1.75rem', position: 'relative' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#fff' }}>
                Create New Designation
              </h3>
              <button
                type="button"
                onClick={() => setDialogOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            {formError && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.75rem',
                  borderRadius: '6px',
                  backgroundColor: 'var(--danger-light)',
                  color: '#fca5a5',
                  fontSize: '0.8125rem',
                  marginBottom: '1rem',
                }}
              >
                <AlertCircle size={16} />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label
                  htmlFor="desig-name"
                  style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.375rem' }}
                >
                  Job Title *
                </label>
                <input
                  id="desig-name"
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Lead Security Architect"
                  className="form-input"
                />
              </div>

              <div>
                <label
                  htmlFor="desig-code"
                  style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.375rem' }}
                >
                  Unique Code *
                </label>
                <input
                  id="desig-code"
                  type="text"
                  required
                  value={code}
                  onChange={e => setCode(e.target.value.toUpperCase())}
                  placeholder="e.g. SEC-ARCH"
                  className="form-input"
                  style={{ textTransform: 'uppercase', fontFamily: 'monospace' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                <button
                  type="button"
                  onClick={() => setDialogOpen(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="btn-primary"
                >
                  {creating ? 'Saving...' : 'Create Designation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
