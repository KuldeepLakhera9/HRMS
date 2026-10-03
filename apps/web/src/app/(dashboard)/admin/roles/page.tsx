'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  Plus,
  Trash2,
  Save,
  X,
  Lock,
  Layers,
  ShieldCheck,
} from 'lucide-react';

interface RolePermission {
  permission_key: string;
  scope: 'self' | 'team' | 'department' | 'location' | 'company';
}

interface RoleItem {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  requires_mfa: boolean;
  version: number;
  user_count: number;
  permission_count: number;
  permissions?: RolePermission[];
}

interface CatalogItem {
  key: string;
  category: string;
  label: string;
  description: string;
  allowedScopes: ('self' | 'team' | 'department' | 'location' | 'company')[];
}

export default function AdminRolesPage() {
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected Role for Permission Matrix Editing
  const [activeRole, setActiveRole] = useState<RoleItem | null>(null);
  const [editedPermissions, setEditedPermissions] = useState<Record<string, RolePermission['scope']>>({});
  const [savingMatrix, setSavingMatrix] = useState(false);

  // Create Role Modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleDesc, setNewRoleDesc] = useState('');
  const [newRoleRequiresMfa, setNewRoleRequiresMfa] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);

  // Status message
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const fetchRoles = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/v1/roles');
      if (!res.ok) {
        throw new Error('Failed to load roles');
      }
      const json = await res.json();
      setRoles(json.data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error fetching roles');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchCatalog = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/permissions/catalog');
      if (res.ok) {
        const json = await res.json();
        setCatalog(json.data ?? []);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  useEffect(() => {
    fetchRoles();
    fetchCatalog();
  }, [fetchRoles, fetchCatalog]);

  const selectRoleForEditing = async (role: RoleItem) => {
    try {
      setMessage(null);
      const res = await fetch(`/api/v1/roles/${role.id}`);
      if (!res.ok) throw new Error('Failed to load role details');
      const json = await res.json();
      const detailedRole: RoleItem = json.data;
      setActiveRole(detailedRole);

      // Build dictionary of enabled permissions and their scopes
      const map: Record<string, RolePermission['scope']> = {};
      if (detailedRole.permissions) {
        for (const p of detailedRole.permissions) {
          map[p.permission_key] = p.scope;
        }
      }
      setEditedPermissions(map);
    } catch (err: unknown) {
      setMessage({
        text: err instanceof Error ? err.message : 'Error loading role',
        type: 'error',
      });
    }
  };

  const handleTogglePermission = (permKey: string) => {
    setEditedPermissions(prev => {
      const next = { ...prev };
      if (next[permKey]) {
        delete next[permKey];
      } else {
        next[permKey] = 'company'; // Default scope
      }
      return next;
    });
  };

  const handleScopeChange = (permKey: string, scope: RolePermission['scope']) => {
    setEditedPermissions(prev => ({
      ...prev,
      [permKey]: scope,
    }));
  };

  const handleToggleCategory = (categoryName: string, enable: boolean) => {
    const categoryPerms = catalog.filter(c => c.category === categoryName);
    setEditedPermissions(prev => {
      const next = { ...prev };
      for (const p of categoryPerms) {
        if (enable) {
          if (!next[p.key]) next[p.key] = 'company';
        } else {
          delete next[p.key];
        }
      }
      return next;
    });
  };

  const handleSavePermissions = async () => {
    if (!activeRole) return;
    try {
      setSavingMatrix(true);
      const permPayload = Object.entries(editedPermissions).map(([permissionKey, scope]) => ({
        permissionKey,
        scope,
      }));

      const res = await fetch(`/api/v1/roles/${activeRole.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions: permPayload }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error?.message ?? 'Failed to update permissions');
      }

      setMessage({ text: `Permissions saved for "${activeRole.name}".`, type: 'success' });
      fetchRoles();
    } catch (err: unknown) {
      setMessage({
        text: err instanceof Error ? err.message : 'Error saving permissions',
        type: 'error',
      });
    } finally {
      setSavingMatrix(false);
    }
  };

  const handleCreateRole = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setCreateSubmitting(true);
      const res = await fetch('/api/v1/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newRoleName.trim(),
          description: newRoleDesc.trim() || undefined,
          requiresMfa: newRoleRequiresMfa,
          permissions: [],
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error?.message ?? 'Failed to create role');
      }

      const json = await res.json();
      setMessage({ text: `Custom role "${newRoleName}" created successfully.`, type: 'success' });
      setCreateModalOpen(false);
      setNewRoleName('');
      setNewRoleDesc('');
      setNewRoleRequiresMfa(false);
      await fetchRoles();
      selectRoleForEditing(json.data);
    } catch (err: unknown) {
      setMessage({
        text: err instanceof Error ? err.message : 'Error creating role',
        type: 'error',
      });
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleDeleteRole = async (role: RoleItem) => {
    if (!confirm(`Are you sure you want to delete role "${role.name}"?`)) return;
    try {
      const res = await fetch(`/api/v1/roles/${role.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error?.message ?? 'Failed to delete role');
      }

      setMessage({ text: `Role "${role.name}" deleted.`, type: 'success' });
      if (activeRole?.id === role.id) {
        setActiveRole(null);
      }
      fetchRoles();
    } catch (err: unknown) {
      setMessage({
        text: err instanceof Error ? err.message : 'Error deleting role',
        type: 'error',
      });
    }
  };

  // Group catalog by category
  const categories = Array.from(new Set(catalog.map(c => c.category)));

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <Shield size={28} color="var(--primary-color)" />
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0 }}>Roles & Permission Matrix</h1>
          </div>
          <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.95rem' }}>
            Configure role access policies, permission scopes, and role-based access control.
          </p>
        </div>

        <button
          onClick={() => setCreateModalOpen(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.625rem 1.25rem',
            backgroundColor: 'var(--primary-color)',
            color: '#fff',
            border: 'none',
            borderRadius: '8px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <Plus size={18} />
          Create Custom Role
        </button>
      </div>

      {/* Message Banner */}
      {message && (
        <div
          style={{
            padding: '0.875rem 1.25rem',
            marginBottom: '1.5rem',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: message.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            border: `1px solid ${message.type === 'success' ? '#10b981' : '#ef4444'}`,
            color: message.type === 'success' ? '#10b981' : '#ef4444',
          }}
        >
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>
      )}

      {/* Main Grid: Roles List (Left) and Matrix Editor (Right) */}
      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '1.5rem', alignItems: 'start' }}>
        {/* Left Column: Roles Cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: '0 0 0.5rem 0', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
            Tenant Roles ({roles.length})
          </h2>

          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading roles...</div>
          ) : error ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#ef4444' }}>{error}</div>
          ) : roles.map(r => {
            const isSelected = activeRole?.id === r.id;
            return (
              <div
                key={r.id}
                onClick={() => selectRoleForEditing(r)}
                style={{
                  padding: '1.25rem',
                  backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg-secondary)',
                  border: `1px solid ${isSelected ? '#3b82f6' : 'var(--border-color)'}`,
                  borderRadius: '10px',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '1.05rem' }}>{r.name}</span>
                      {r.is_system ? (
                        <span
                          style={{
                            padding: '0.1rem 0.4rem',
                            backgroundColor: 'rgba(100, 116, 139, 0.15)',
                            color: 'var(--text-secondary)',
                            borderRadius: '4px',
                            fontSize: '0.7rem',
                            fontWeight: 600,
                          }}
                        >
                          System
                        </span>
                      ) : (
                        <span
                          style={{
                            padding: '0.1rem 0.4rem',
                            backgroundColor: 'rgba(16, 185, 129, 0.15)',
                            color: '#10b981',
                            borderRadius: '4px',
                            fontSize: '0.7rem',
                            fontWeight: 600,
                          }}
                        >
                          Custom
                        </span>
                      )}
                    </div>
                    {r.description && (
                      <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {r.description}
                      </p>
                    )}
                  </div>

                  {!r.is_system && (
                    <button
                      title="Delete Role"
                      onClick={e => {
                        e.stopPropagation();
                        handleDeleteRole(r);
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#ef4444',
                        cursor: 'pointer',
                        padding: '0.25rem',
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '1rem', marginTop: '0.75rem', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                  <div>
                    <strong>{r.user_count}</strong> Assigned Users
                  </div>
                  <div>
                    <strong>{r.permission_count}</strong> Grants
                  </div>
                  {r.requires_mfa && (
                    <div style={{ color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      <ShieldCheck size={14} /> MFA Enforced
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Right Column: Permission Matrix Editor */}
        <div
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            padding: '1.75rem',
          }}
        >
          {activeRole ? (
            <div>
              {/* Matrix Header */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '1.5rem',
                  paddingBottom: '1rem',
                  borderBottom: '1px solid var(--border-color)',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>
                      Permissions for &ldquo;{activeRole.name}&rdquo;
                    </h2>
                    {activeRole.is_system && (
                      <span title="System role rules apply" style={{ color: 'var(--text-secondary)' }}>
                        <Lock size={16} />
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                    {Object.keys(editedPermissions).length} active grants configured
                  </div>
                </div>

                <button
                  onClick={handleSavePermissions}
                  disabled={savingMatrix}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.625rem 1.25rem',
                    backgroundColor: 'var(--primary-color)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 600,
                    cursor: savingMatrix ? 'not-allowed' : 'pointer',
                    opacity: savingMatrix ? 0.7 : 1,
                  }}
                >
                  <Save size={16} />
                  {savingMatrix ? 'Saving...' : 'Save Matrix'}
                </button>
              </div>

              {/* Matrix Categories */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {categories.map(category => {
                  const categoryItems = catalog.filter(c => c.category === category);
                  const allSelected = categoryItems.every(c => !!editedPermissions[c.key]);

                  return (
                    <div
                      key={category}
                      style={{
                        border: '1px solid var(--border-color)',
                        borderRadius: '8px',
                        overflow: 'hidden',
                        backgroundColor: 'var(--bg-primary)',
                      }}
                    >
                      {/* Category Header */}
                      <div
                        style={{
                          padding: '0.75rem 1rem',
                          backgroundColor: 'rgba(255,255,255,0.03)',
                          borderBottom: '1px solid var(--border-color)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ fontWeight: 700, fontSize: '0.85rem', letterSpacing: '0.05em' }}>
                          {category}
                        </span>

                        <button
                          type="button"
                          onClick={() => handleToggleCategory(category, !allSelected)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--primary-color)',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          {allSelected ? 'Clear All' : 'Select All'}
                        </button>
                      </div>

                      {/* Items */}
                      <div>
                        {categoryItems.map(item => {
                          const isChecked = !!editedPermissions[item.key];
                          const currentScope = editedPermissions[item.key] ?? 'company';

                          return (
                            <div
                              key={item.key}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '0.75rem 1rem',
                                borderBottom: '1px solid var(--border-color)',
                                backgroundColor: isChecked ? 'rgba(59, 130, 246, 0.03)' : 'transparent',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => handleTogglePermission(item.key)}
                                  style={{ cursor: 'pointer', width: '16px', height: '16px' }}
                                />
                                <div>
                                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{item.label}</div>
                                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                                    {item.key}
                                  </div>
                                </div>
                              </div>

                              {/* Scope Selector */}
                              {isChecked && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Scope:</span>
                                  <select
                                    value={currentScope}
                                    onChange={e => handleScopeChange(item.key, e.target.value as RolePermission['scope'])}
                                    style={{
                                      padding: '0.25rem 0.5rem',
                                      backgroundColor: 'var(--bg-secondary)',
                                      border: '1px solid var(--border-color)',
                                      borderRadius: '4px',
                                      color: 'inherit',
                                      fontSize: '0.8rem',
                                      fontWeight: 600,
                                    }}
                                  >
                                    {item.allowedScopes.map(s => (
                                      <option key={s} value={s}>
                                        {s.toUpperCase()}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-secondary)' }}>
              <Layers size={40} style={{ margin: '0 auto 1rem', opacity: 0.4 }} />
              <div style={{ fontWeight: 600 }}>Select a role from the left to view and configure its permission matrix.</div>
            </div>
          )}
        </div>
      </div>

      {/* Create Custom Role Modal */}
      {createModalOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            backdropFilter: 'blur(3px)',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-secondary)',
              borderRadius: '12px',
              border: '1px solid var(--border-color)',
              padding: '2rem',
              width: '100%',
              maxWidth: '480px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Create Custom Role</h2>
              <button
                onClick={() => setCreateModalOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateRole}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                  Role Name *
                </label>
                <input
                  type="text"
                  required
                  value={newRoleName}
                  onChange={e => setNewRoleName(e.target.value)}
                  placeholder="e.g. branch_operations_lead"
                  style={{
                    width: '100%',
                    padding: '0.625rem',
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'inherit',
                  }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                  Description
                </label>
                <textarea
                  value={newRoleDesc}
                  onChange={e => setNewRoleDesc(e.target.value)}
                  placeholder="Responsibilities and purpose of this custom role"
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '0.625rem',
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'inherit',
                    resize: 'vertical',
                  }}
                />
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={newRoleRequiresMfa}
                    onChange={e => setNewRoleRequiresMfa(e.target.checked)}
                  />
                  <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                    Enforce Multi-Factor Authentication (MFA)
                  </span>
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  style={{
                    padding: '0.625rem 1.25rem',
                    backgroundColor: 'transparent',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createSubmitting}
                  style={{
                    padding: '0.625rem 1.25rem',
                    backgroundColor: 'var(--primary-color)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    fontWeight: 600,
                    cursor: createSubmitting ? 'not-allowed' : 'pointer',
                    opacity: createSubmitting ? 0.7 : 1,
                  }}
                >
                  {createSubmitting ? 'Creating...' : 'Create Role'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
