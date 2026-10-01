'use client';

import React, { useEffect, useState } from 'react';
import {
  Layers,
  Plus,
  Search,
  CheckCircle,
  XCircle,
  X,
  AlertCircle,
} from 'lucide-react';

interface CostCenter {
  id: string;
  name: string;
  code: string;
  active: boolean;
}

export default function CostCentersPage() {
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  // New Cost Center Form State
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadCostCenters = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/v1/org/cost-centers');
      if (res.ok) {
        const data = await res.json();
        setCostCenters(data.costCenters || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCostCenters();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setFormError(null);

    try {
      const res = await fetch('/api/v1/org/cost-centers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          code: code.toUpperCase(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error?.message || 'Failed to create cost center.');
      } else {
        setName('');
        setCode('');
        setDialogOpen(false);
        loadCostCenters();
      }
    } catch {
      setFormError('Network communication error.');
    } finally {
      setCreating(false);
    }
  };

  const filtered = costCenters.filter(
    c =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.code.toLowerCase().includes(search.toLowerCase()),
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
            <Layers size={16} color="var(--warning)" />
            <span style={{ fontSize: '0.8125rem', color: 'var(--warning)', fontWeight: 600 }}>ORGANIZATION</span>
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            Cost Centers
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Financial accounting entities for payroll allocation and departmental expenditure.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="btn-primary"
        >
          <Plus size={16} />
          <span>New Cost Center</span>
        </button>
      </div>

      {/* Search */}
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
          placeholder="Search by cost center or code..."
          className="form-input"
          style={{ paddingLeft: '2.5rem' }}
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading cost centers...
        </div>
      ) : (
        <div className="glass-panel" style={{ overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(15, 23, 42, 0.5)' }}>
                <th style={{ padding: '0.875rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>
                  Cost Center Name
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
                    No cost centers found.
                  </td>
                </tr>
              ) : (
                filtered.map(c => (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '0.875rem 1.25rem', color: '#fff', fontWeight: 600 }}>
                      {c.name}
                    </td>
                    <td style={{ padding: '0.875rem 1.25rem' }}>
                      <span
                        style={{
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(245, 158, 11, 0.1)',
                          color: 'var(--warning)',
                          fontSize: '0.75rem',
                          fontFamily: 'monospace',
                          fontWeight: 600,
                        }}
                      >
                        {c.code}
                      </span>
                    </td>
                    <td style={{ padding: '0.875rem 1.25rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.75rem' }}>
                        {c.active ? (
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

      {/* Modal Dialog: Add Cost Center */}
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
                Create Cost Center
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
                  htmlFor="cc-name"
                  style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.375rem' }}
                >
                  Cost Center Name *
                </label>
                <input
                  id="cc-name"
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Artificial Intelligence Research"
                  className="form-input"
                />
              </div>

              <div>
                <label
                  htmlFor="cc-code"
                  style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.375rem' }}
                >
                  Accounting Code * (Unique)
                </label>
                <input
                  id="cc-code"
                  type="text"
                  required
                  value={code}
                  onChange={e => setCode(e.target.value.toUpperCase())}
                  placeholder="e.g. CC-AI-RES"
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
                  {creating ? 'Saving...' : 'Create Cost Center'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
