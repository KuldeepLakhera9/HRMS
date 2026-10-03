'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  UserPlus,
  Shield,
  ShieldCheck,
  Search,
  KeyRound,
  RotateCcw,
  UserX,
  UserCheck,
  LogOut,
  Copy,
  Check,
  Eye,
  X,
} from 'lucide-react';

interface RoleRef {
  id: string;
  name: string;
}

interface UserItem {
  id: string;
  company_id: string;
  email: string;
  status: 'invited' | 'active' | 'locked' | 'disabled';
  mfa_enabled: boolean;
  failed_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
  perm_version: number;
  employee_id: string | null;
  created_at: string;
  updated_at: string;
  roles: RoleRef[];
  employee: {
    id: string;
    emp_code: string;
    first_name: string;
    last_name: string;
  } | null;
}

interface RoleItem {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  requires_mfa: boolean;
  user_count: number;
  permission_count: number;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Modals state
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteStatus, setInviteStatus] = useState<'active' | 'invited'>('active');
  const [inviteRoleIds, setInviteRoleIds] = useState<string[]>([]);
  const [inviteSuccessData, setInviteSuccessData] = useState<{ email: string; temporaryPassword?: string } | null>(null);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);

  // Edit Roles Modal
  const [editRolesUser, setEditRolesUser] = useState<UserItem | null>(null);
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([]);
  const [rolesSubmitting, setRolesSubmitting] = useState(false);

  // Effective Permissions Modal
  const [effectivePermsUser, setEffectivePermsUser] = useState<UserItem | null>(null);
  const [effectivePermsData, setEffectivePermsData] = useState<{
    roles: string[];
    permissions: string[];
    effectivePermissions: Record<string, string>;
  } | null>(null);
  const [effectiveLoading, setEffectiveLoading] = useState(false);

  // Action status message
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      params.set('limit', '50');

      const res = await fetch(`/api/v1/users?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error?.message ?? 'Failed to load users');
      }
      const json = await res.json();
      setUsers(json.data ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error fetching users');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  const fetchRoles = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/roles');
      if (res.ok) {
        const json = await res.json();
        setRoles(json.data ?? []);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    fetchRoles();
  }, [fetchRoles]);

  const handleInviteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setInviteSubmitting(true);
      const res = await fetch('/api/v1/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          password: invitePassword.trim() || undefined,
          status: inviteStatus,
          roleIds: inviteRoleIds,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message ?? 'Failed to create user');
      }

      setInviteSuccessData({
        email: inviteEmail,
        temporaryPassword: json.temporaryPassword,
      });
      fetchUsers();
    } catch (err: unknown) {
      setActionMessage({
        text: err instanceof Error ? err.message : 'Failed to create user',
        type: 'error',
      });
    } finally {
      setInviteSubmitting(false);
    }
  };

  const handleUpdateRoles = async () => {
    if (!editRolesUser) return;
    try {
      setRolesSubmitting(true);
      const res = await fetch(`/api/v1/users/${editRolesUser.id}/roles`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleIds: selectedRoleIds }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error?.message ?? 'Failed to update roles');
      }

      setActionMessage({ text: 'User roles updated and session cache refreshed.', type: 'success' });
      setEditRolesUser(null);
      fetchUsers();
    } catch (err: unknown) {
      setActionMessage({
        text: err instanceof Error ? err.message : 'Failed to update roles',
        type: 'error',
      });
    } finally {
      setRolesSubmitting(false);
    }
  };

  const handleDeactivate = async (user: UserItem) => {
    if (!confirm(`Are you sure you want to deactivate ${user.email}? All active sessions will be terminated.`)) return;
    try {
      const res = await fetch(`/api/v1/users/${user.id}/deactivate`, { method: 'POST' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error?.message ?? 'Failed to deactivate user');
      }
      setActionMessage({ text: `${user.email} deactivated. Sessions revoked.`, type: 'success' });
      fetchUsers();
    } catch (err: unknown) {
      setActionMessage({ text: err instanceof Error ? err.message : 'Error', type: 'error' });
    }
  };

  const handleReactivate = async (user: UserItem) => {
    try {
      const res = await fetch(`/api/v1/users/${user.id}/reactivate`, { method: 'POST' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error?.message ?? 'Failed to reactivate user');
      }
      setActionMessage({ text: `${user.email} reactivated successfully.`, type: 'success' });
      fetchUsers();
    } catch (err: unknown) {
      setActionMessage({ text: err instanceof Error ? err.message : 'Error', type: 'error' });
    }
  };

  const handleResetMfa = async (user: UserItem) => {
    if (!confirm(`Reset 2FA / MFA for ${user.email}? User will be prompted to re-enroll MFA on next login.`)) return;
    try {
      const res = await fetch(`/api/v1/users/${user.id}/reset-mfa`, { method: 'POST' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error?.message ?? 'Failed to reset MFA');
      }
      setActionMessage({ text: `MFA reset for ${user.email}.`, type: 'success' });
      fetchUsers();
    } catch (err: unknown) {
      setActionMessage({ text: err instanceof Error ? err.message : 'Error', type: 'error' });
    }
  };

  const handleRevokeSessions = async (user: UserItem) => {
    if (!confirm(`Revoke all active sessions for ${user.email}?`)) return;
    try {
      const res = await fetch(`/api/v1/users/${user.id}/revoke-sessions`, { method: 'POST' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error?.message ?? 'Failed to revoke sessions');
      }
      const json = await res.json();
      setActionMessage({ text: `Revoked ${json.data?.revoked ?? 0} active session(s).`, type: 'success' });
    } catch (err: unknown) {
      setActionMessage({ text: err instanceof Error ? err.message : 'Error', type: 'error' });
    }
  };

  const handleViewEffectivePermissions = async (user: UserItem) => {
    setEffectivePermsUser(user);
    setEffectiveLoading(true);
    try {
      const res = await fetch(`/api/v1/users/${user.id}/effective-permissions`);
      if (res.ok) {
        const json = await res.json();
        setEffectivePermsData(json.data);
      }
    } catch {
      // Non-fatal
    } finally {
      setEffectiveLoading(false);
    }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <Users size={28} color="var(--primary-color)" />
            <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0 }}>User Management</h1>
          </div>
          <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.95rem' }}>
            Manage identity accounts, role assignments, multi-factor authentication, and active sessions.
          </p>
        </div>

        <button
          onClick={() => {
            setInviteEmail('');
            setInvitePassword('');
            setInviteRoleIds([]);
            setInviteSuccessData(null);
            setInviteModalOpen(true);
          }}
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
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          }}
        >
          <UserPlus size={18} />
          Add / Invite User
        </button>
      </div>

      {/* Banner Message */}
      {actionMessage && (
        <div
          style={{
            padding: '0.875rem 1.25rem',
            marginBottom: '1.5rem',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: actionMessage.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            border: `1px solid ${actionMessage.type === 'success' ? '#10b981' : '#ef4444'}`,
            color: actionMessage.type === 'success' ? '#10b981' : '#ef4444',
          }}
        >
          <span>{actionMessage.text}</span>
          <button
            onClick={() => setActionMessage(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Filters Bar */}
      <div
        style={{
          display: 'flex',
          gap: '1rem',
          marginBottom: '1.5rem',
          backgroundColor: 'var(--bg-secondary)',
          padding: '1rem',
          borderRadius: '10px',
          border: '1px solid var(--border-color)',
          alignItems: 'center',
        }}
      >
        <div style={{ position: 'relative', flex: 1 }}>
          <Search
            size={18}
            style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }}
          />
          <input
            type="text"
            placeholder="Search by email, employee name or code..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%',
              padding: '0.625rem 0.75rem 0.625rem 2.5rem',
              backgroundColor: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              color: 'inherit',
              fontSize: '0.9rem',
            }}
          />
        </div>

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{
            padding: '0.625rem 1rem',
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '6px',
            color: 'inherit',
            fontSize: '0.9rem',
          }}
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="invited">Invited</option>
          <option value="disabled">Disabled</option>
          <option value="locked">Locked</option>
        </select>
      </div>

      {/* Users Table */}
      <div
        style={{
          backgroundColor: 'var(--bg-secondary)',
          borderRadius: '10px',
          border: '1px solid var(--border-color)',
          overflow: 'hidden',
        }}
      >
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading users...</div>
        ) : error ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#ef4444' }}>{error}</div>
        ) : users.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            No users match the criteria.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                <th style={{ padding: '1rem' }}>User Email</th>
                <th style={{ padding: '1rem' }}>Employee Link</th>
                <th style={{ padding: '1rem' }}>Status</th>
                <th style={{ padding: '1rem' }}>Roles</th>
                <th style={{ padding: '1rem' }}>MFA</th>
                <th style={{ padding: '1rem' }}>Last Login</th>
                <th style={{ padding: '1rem', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '1rem' }}>
                    <div style={{ fontWeight: 600 }}>{u.email}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>ID: {u.id.substring(0, 8)}...</div>
                  </td>
                  <td style={{ padding: '1rem' }}>
                    {u.employee ? (
                      <div>
                        <div style={{ fontWeight: 500 }}>
                          {u.employee.first_name} {u.employee.last_name}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--primary-color)' }}>{u.employee.emp_code}</div>
                      </div>
                    ) : (
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                        Unlinked
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '0.2rem 0.6rem',
                        borderRadius: '12px',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        backgroundColor:
                          u.status === 'active'
                            ? 'rgba(16, 185, 129, 0.15)'
                            : u.status === 'invited'
                            ? 'rgba(245, 158, 11, 0.15)'
                            : 'rgba(239, 68, 68, 0.15)',
                        color:
                          u.status === 'active'
                            ? '#10b981'
                            : u.status === 'invited'
                            ? '#f59e0b'
                            : '#ef4444',
                      }}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                      {u.roles.map(r => (
                        <span
                          key={r.id}
                          style={{
                            padding: '0.15rem 0.5rem',
                            backgroundColor: 'rgba(59, 130, 246, 0.12)',
                            color: '#3b82f6',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            fontWeight: 500,
                          }}
                        >
                          {r.name}
                        </span>
                      ))}
                      {u.roles.length === 0 && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>None</span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: '1rem' }}>
                    {u.mfa_enabled ? (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: '#10b981', fontSize: '0.85rem' }}>
                        <ShieldCheck size={16} /> Enabled
                      </span>
                    ) : (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        <Shield size={16} /> Off
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'Never'}
                  </td>
                  <td style={{ padding: '1rem', textAlign: 'right' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                      <button
                        title="Edit Roles"
                        onClick={() => {
                          setEditRolesUser(u);
                          setSelectedRoleIds(u.roles.map(r => r.id));
                        }}
                        style={{
                          padding: '0.375rem 0.5rem',
                          backgroundColor: 'transparent',
                          border: '1px solid var(--border-color)',
                          borderRadius: '6px',
                          color: 'inherit',
                          cursor: 'pointer',
                        }}
                      >
                        <KeyRound size={15} />
                      </button>

                      <button
                        title="View Effective Permissions"
                        onClick={() => handleViewEffectivePermissions(u)}
                        style={{
                          padding: '0.375rem 0.5rem',
                          backgroundColor: 'transparent',
                          border: '1px solid var(--border-color)',
                          borderRadius: '6px',
                          color: 'inherit',
                          cursor: 'pointer',
                        }}
                      >
                        <Eye size={15} />
                      </button>

                      {u.mfa_enabled && (
                        <button
                          title="Reset MFA"
                          onClick={() => handleResetMfa(u)}
                          style={{
                            padding: '0.375rem 0.5rem',
                            backgroundColor: 'transparent',
                            border: '1px solid var(--border-color)',
                            borderRadius: '6px',
                            color: '#f59e0b',
                            cursor: 'pointer',
                          }}
                        >
                          <RotateCcw size={15} />
                        </button>
                      )}

                      <button
                        title="Revoke All Sessions"
                        onClick={() => handleRevokeSessions(u)}
                        style={{
                          padding: '0.375rem 0.5rem',
                          backgroundColor: 'transparent',
                          border: '1px solid var(--border-color)',
                          borderRadius: '6px',
                          color: 'inherit',
                          cursor: 'pointer',
                        }}
                      >
                        <LogOut size={15} />
                      </button>

                      {u.status === 'active' ? (
                        <button
                          title="Deactivate Account"
                          onClick={() => handleDeactivate(u)}
                          style={{
                            padding: '0.375rem 0.5rem',
                            backgroundColor: 'transparent',
                            border: '1px solid var(--border-color)',
                            borderRadius: '6px',
                            color: '#ef4444',
                            cursor: 'pointer',
                          }}
                        >
                          <UserX size={15} />
                        </button>
                      ) : (
                        <button
                          title="Reactivate Account"
                          onClick={() => handleReactivate(u)}
                          style={{
                            padding: '0.375rem 0.5rem',
                            backgroundColor: 'transparent',
                            border: '1px solid var(--border-color)',
                            borderRadius: '6px',
                            color: '#10b981',
                            cursor: 'pointer',
                          }}
                        >
                          <UserCheck size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Invite / Add User Modal */}
      {inviteModalOpen && (
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
              maxWidth: '520px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Add / Invite User</h2>
              <button
                onClick={() => setInviteModalOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            {inviteSuccessData ? (
              <div>
                <div
                  style={{
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    border: '1px solid #10b981',
                    borderRadius: '8px',
                    padding: '1rem',
                    marginBottom: '1.5rem',
                    textAlign: 'center',
                  }}
                >
                  <ShieldCheck size={32} color="#10b981" style={{ margin: '0 auto 0.5rem' }} />
                  <div style={{ fontWeight: 600, color: '#10b981', marginBottom: '0.25rem' }}>
                    User Created Successfully
                  </div>
                  <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    Account created for <strong>{inviteSuccessData.email}</strong>
                  </div>
                </div>

                {inviteSuccessData.temporaryPassword && (
                  <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', display: 'block' }}>
                      Generated Password:
                    </label>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.75rem 1rem',
                        backgroundColor: 'var(--bg-primary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '6px',
                        fontFamily: 'monospace',
                        fontSize: '1rem',
                      }}
                    >
                      <span>{inviteSuccessData.temporaryPassword}</span>
                      <button
                        onClick={() => {
                          if (inviteSuccessData.temporaryPassword) {
                            navigator.clipboard.writeText(inviteSuccessData.temporaryPassword);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2000);
                          }
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: copied ? '#10b981' : 'var(--text-secondary)',
                          cursor: 'pointer',
                        }}
                      >
                        {copied ? <Check size={18} /> : <Copy size={18} />}
                      </button>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => setInviteModalOpen(false)}
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    backgroundColor: 'var(--primary-color)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '8px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={handleInviteSubmit}>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                    Email Address *
                  </label>
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    placeholder="colleague@company.com"
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
                    Password (leave empty to auto-generate)
                  </label>
                  <input
                    type="password"
                    value={invitePassword}
                    onChange={e => setInvitePassword(e.target.value)}
                    placeholder="Min 8 chars, 1 uppercase, 1 digit, 1 symbol"
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
                    Initial Status
                  </label>
                  <select
                    value={inviteStatus}
                    onChange={e => setInviteStatus(e.target.value as 'active' | 'invited')}
                    style={{
                      width: '100%',
                      padding: '0.625rem',
                      backgroundColor: 'var(--bg-primary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      color: 'inherit',
                    }}
                  >
                    <option value="active">Active (Immediate Login)</option>
                    <option value="invited">Invited (Send invitation email)</option>
                  </select>
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>
                    Assign Roles
                  </label>
                  <div
                    style={{
                      maxHeight: '160px',
                      overflowY: 'auto',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      padding: '0.5rem',
                      backgroundColor: 'var(--bg-primary)',
                    }}
                  >
                    {roles.map(r => (
                      <label
                        key={r.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          padding: '0.35rem 0.5rem',
                          borderRadius: '4px',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={inviteRoleIds.includes(r.id)}
                          onChange={e => {
                            if (e.target.checked) {
                              setInviteRoleIds([...inviteRoleIds, r.id]);
                            } else {
                              setInviteRoleIds(inviteRoleIds.filter(id => id !== r.id));
                            }
                          }}
                        />
                        <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>{r.name}</span>
                        {r.is_system && (
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>(System)</span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                  <button
                    type="button"
                    onClick={() => setInviteModalOpen(false)}
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
                    disabled={inviteSubmitting}
                    style={{
                      padding: '0.625rem 1.25rem',
                      backgroundColor: 'var(--primary-color)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      fontWeight: 600,
                      cursor: inviteSubmitting ? 'not-allowed' : 'pointer',
                      opacity: inviteSubmitting ? 0.7 : 1,
                    }}
                  >
                    {inviteSubmitting ? 'Creating...' : 'Create User'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Edit Roles Modal */}
      {editRolesUser && (
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Assign Roles</h2>
              <button
                onClick={() => setEditRolesUser(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '1.25rem' }}>
              Configuring roles for <strong>{editRolesUser.email}</strong>. Changes take effect immediately.
            </p>

            <div
              style={{
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '0.75rem',
                maxHeight: '260px',
                overflowY: 'auto',
                marginBottom: '1.5rem',
                backgroundColor: 'var(--bg-primary)',
              }}
            >
              {roles.map(r => (
                <label
                  key={r.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.5rem',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedRoleIds.includes(r.id)}
                    onChange={e => {
                      if (e.target.checked) {
                        setSelectedRoleIds([...selectedRoleIds, r.id]);
                      } else {
                        setSelectedRoleIds(selectedRoleIds.filter(id => id !== r.id));
                      }
                    }}
                  />
                  <div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{r.name}</div>
                    {r.description && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{r.description}</div>
                    )}
                  </div>
                </label>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setEditRolesUser(null)}
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
                type="button"
                onClick={handleUpdateRoles}
                disabled={rolesSubmitting}
                style={{
                  padding: '0.625rem 1.25rem',
                  backgroundColor: 'var(--primary-color)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: rolesSubmitting ? 'not-allowed' : 'pointer',
                  opacity: rolesSubmitting ? 0.7 : 1,
                }}
              >
                {rolesSubmitting ? 'Saving...' : 'Save Roles'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Effective Permissions Modal */}
      {effectivePermsUser && (
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
              maxWidth: '650px',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Effective Permissions</h2>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Computed union for <strong>{effectivePermsUser.email}</strong>
                </div>
              </div>
              <button
                onClick={() => setEffectivePermsUser(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            {effectiveLoading ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                Resolving effective permissions...
              </div>
            ) : effectivePermsData ? (
              <div style={{ overflowY: 'auto', flex: 1, paddingRight: '0.5rem' }}>
                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                    Active Roles
                  </label>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                    {effectivePermsData.roles.map(r => (
                      <span
                        key={r}
                        style={{
                          padding: '0.2rem 0.6rem',
                          backgroundColor: 'rgba(59, 130, 246, 0.15)',
                          color: '#3b82f6',
                          borderRadius: '4px',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                        }}
                      >
                        {r}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
                    Resolved Permissions ({Object.keys(effectivePermsData.effectivePermissions).length})
                  </label>
                  <div
                    style={{
                      border: '1px solid var(--border-color)',
                      borderRadius: '8px',
                      overflow: 'hidden',
                      marginTop: '0.5rem',
                      backgroundColor: 'var(--bg-primary)',
                    }}
                  >
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                          <th style={{ padding: '0.625rem 0.875rem', textAlign: 'left' }}>Permission Key</th>
                          <th style={{ padding: '0.625rem 0.875rem', textAlign: 'right' }}>Granted Scope</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(effectivePermsData.effectivePermissions)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([key, scope]) => (
                            <tr key={key} style={{ borderBottom: '1px solid var(--border-color)' }}>
                              <td style={{ padding: '0.5rem 0.875rem', fontFamily: 'monospace' }}>{key}</td>
                              <td style={{ padding: '0.5rem 0.875rem', textAlign: 'right' }}>
                                <span
                                  style={{
                                    padding: '0.15rem 0.5rem',
                                    borderRadius: '4px',
                                    fontWeight: 600,
                                    fontSize: '0.75rem',
                                    backgroundColor:
                                      scope === 'company'
                                        ? 'rgba(16, 185, 129, 0.15)'
                                        : 'rgba(59, 130, 246, 0.15)',
                                    color: scope === 'company' ? '#10b981' : '#3b82f6',
                                    textTransform: 'uppercase',
                                  }}
                                >
                                  {scope}
                                </span>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>
                No permission data available.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
