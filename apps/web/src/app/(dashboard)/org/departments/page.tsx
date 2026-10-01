'use client';

import React, { useEffect, useState } from 'react';
import {
  GitFork,
  Plus,
  Search,
  CheckCircle,
  XCircle,
  X,
  AlertCircle,
  ChevronRight,
  FolderTree,
} from 'lucide-react';

interface Department {
  id: string;
  name: string;
  code: string;
  parentId: string | null;
  active: boolean;
  parentName?: string;
  children?: Department[];
}

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'table' | 'tree'>('table');

  // New Department Form State
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [parentId, setParentId] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadDepartments = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/v1/org/departments');
      if (res.ok) {
        const data = await res.json();
        setDepartments(data.departments || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDepartments();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setFormError(null);

    try {
      const res = await fetch('/api/v1/org/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          code: code.toUpperCase(),
          parentId: parentId || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error?.message || 'Failed to create department.');
      } else {
        setName('');
        setCode('');
        setParentId('');
        setDialogOpen(false);
        loadDepartments();
      }
    } catch {
      setFormError('Network communication error.');
    } finally {
      setCreating(false);
    }
  };

  const filtered = departments.filter(
    d =>
      d.name.toLowerCase().includes(search.toLowerCase()) ||
      d.code.toLowerCase().includes(search.toLowerCase()),
  );

  // Build tree for hierarchical view
  const rootDepts = departments.filter(d => !d.parentId);
  const getChildren = (pId: string) => departments.filter(d => d.parentId === pId);

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
            <GitFork size={16} color="var(--primary)" />
            <span style={{ fontSize: '0.8125rem', color: '#818cf8', fontWeight: 600 }}>ORGANIZATION</span>
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            Departments
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Configure organizational business units, reporting hierarchy, and tree structure.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="btn-primary"
        >
          <Plus size={16} />
          <span>New Department</span>
        </button>
      </div>

      {/* Control Bar: Search and View Mode */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '1rem',
          marginBottom: '1.25rem',
        }}
      >
        <div style={{ position: 'relative', width: '320px' }}>
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
            placeholder="Search by name or code..."
            className="form-input"
            style={{ paddingLeft: '2.5rem' }}
          />
        </div>

        {/* View Toggle */}
        <div
          style={{
            display: 'flex',
            backgroundColor: 'rgba(30, 41, 59, 0.6)',
            borderRadius: '8px',
            padding: '0.25rem',
            border: '1px solid var(--border-color)',
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('table')}
            style={{
              padding: '0.375rem 0.875rem',
              borderRadius: '6px',
              border: 'none',
              fontSize: '0.8125rem',
              fontWeight: 600,
              cursor: 'pointer',
              backgroundColor: activeTab === 'table' ? 'var(--primary)' : 'transparent',
              color: activeTab === 'table' ? '#fff' : 'var(--text-secondary)',
            }}
          >
            Table View
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('tree')}
            style={{
              padding: '0.375rem 0.875rem',
              borderRadius: '6px',
              border: 'none',
              fontSize: '0.8125rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.375rem',
              backgroundColor: activeTab === 'tree' ? 'var(--primary)' : 'transparent',
              color: activeTab === 'tree' ? '#fff' : 'var(--text-secondary)',
            }}
          >
            <FolderTree size={14} />
            <span>Tree View</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading departments...
        </div>
      ) : activeTab === 'table' ? (
        /* Table View */
        <div className="glass-panel" style={{ overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(15, 23, 42, 0.5)' }}>
                <th style={{ padding: '0.875rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>
                  Department Name
                </th>
                <th style={{ padding: '0.875rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>
                  Code
                </th>
                <th style={{ padding: '0.875rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>
                  Parent Unit
                </th>
                <th style={{ padding: '0.875rem 1.25rem', color: 'var(--text-muted)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No departments match the criteria.
                  </td>
                </tr>
              ) : (
                filtered.map(d => (
                  <tr
                    key={d.id}
                    style={{
                      borderBottom: '1px solid var(--border-color)',
                      transition: 'background-color 0.15s ease',
                    }}
                  >
                    <td style={{ padding: '0.875rem 1.25rem', color: '#fff', fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {d.parentId && <ChevronRight size={14} color="var(--text-muted)" />}
                        <span>{d.name}</span>
                      </div>
                    </td>
                    <td style={{ padding: '0.875rem 1.25rem' }}>
                      <span
                        style={{
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(99, 102, 241, 0.1)',
                          color: '#818cf8',
                          fontSize: '0.75rem',
                          fontFamily: 'monospace',
                          fontWeight: 600,
                        }}
                      >
                        {d.code}
                      </span>
                    </td>
                    <td style={{ padding: '0.875rem 1.25rem', color: 'var(--text-secondary)' }}>
                      {d.parentId ? (
                        departments.find(p => p.id === d.parentId)?.name || 'Parent unit'
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Top-level</span>
                      )}
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
      ) : (
        /* Hierarchical Tree View */
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {rootDepts.map(root => {
              const children = getChildren(root.id);
              return (
                <div
                  key={root.id}
                  style={{
                    backgroundColor: 'rgba(30, 41, 59, 0.5)',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    padding: '1rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <GitFork size={18} color="var(--primary)" />
                      <span style={{ fontWeight: 700, fontSize: '0.9375rem', color: '#fff' }}>{root.name}</span>
                      <span
                        style={{
                          fontSize: '0.6875rem',
                          padding: '0.125rem 0.375rem',
                          borderRadius: '4px',
                          backgroundColor: 'rgba(99, 102, 241, 0.15)',
                          color: '#818cf8',
                        }}
                      >
                        {root.code}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {children.length} sub-units
                    </span>
                  </div>

                  {children.length > 0 && (
                    <div
                      style={{
                        marginTop: '0.75rem',
                        paddingLeft: '1.5rem',
                        borderLeft: '2px solid rgba(99, 102, 241, 0.3)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                      }}
                    >
                      {children.map(child => (
                        <div
                          key={child.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0.5rem 0.75rem',
                            backgroundColor: 'rgba(15, 23, 42, 0.5)',
                            borderRadius: '6px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <ChevronRight size={14} color="var(--text-muted)" />
                            <span style={{ fontSize: '0.8125rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                              {child.name}
                            </span>
                            <span
                              style={{
                                fontSize: '0.6875rem',
                                color: 'var(--text-muted)',
                                fontFamily: 'monospace',
                              }}
                            >
                              ({child.code})
                            </span>
                          </div>
                          <span style={{ fontSize: '0.6875rem', color: 'var(--success)' }}>Active</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modal Dialog: Add Department */}
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
            style={{ width: '100%', maxWidth: '480px', padding: '1.75rem', position: 'relative' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#fff' }}>
                Create New Department
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
                  htmlFor="dept-name"
                  style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.375rem' }}
                >
                  Department Name *
                </label>
                <input
                  id="dept-name"
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Cloud Infrastructure"
                  className="form-input"
                />
              </div>

              <div>
                <label
                  htmlFor="dept-code"
                  style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.375rem' }}
                >
                  Department Code * (Unique)
                </label>
                <input
                  id="dept-code"
                  type="text"
                  required
                  value={code}
                  onChange={e => setCode(e.target.value.toUpperCase())}
                  placeholder="e.g. CLOUD-INFRA"
                  className="form-input"
                  style={{ textTransform: 'uppercase', fontFamily: 'monospace' }}
                />
              </div>

              <div>
                <label
                  htmlFor="parent-dept"
                  style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.375rem' }}
                >
                  Parent Department (Optional)
                </label>
                <select
                  id="parent-dept"
                  value={parentId}
                  onChange={e => setParentId(e.target.value)}
                  className="form-input"
                  style={{ cursor: 'pointer' }}
                >
                  <option value="">None (Top-Level Root Department)</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.code})
                    </option>
                  ))}
                </select>
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
                  {creating ? 'Saving...' : 'Create Department'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
