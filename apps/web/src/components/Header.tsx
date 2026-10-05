'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Search,
  Bell,
  LogOut,
  ShieldAlert,
  ChevronDown,
  CheckCheck,
  Settings,
} from 'lucide-react';

interface HeaderProps {
  userEmail?: string;
  roleName?: string;
}

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export function Header({ userEmail = 'admin@orghub.internal', roleName = 'SUPER ADMIN' }: HeaderProps) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Notification state
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loadingNotifs, setLoadingNotifs] = useState(false);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/notifications/unread-count');
      if (res.ok) {
        const json = await res.json();
        setUnreadCount(json.data?.unreadCount || 0);
      }
    } catch {
      // Ignore background fetch failure
    }
  }, []);

  const fetchNotifications = useCallback(async () => {
    try {
      setLoadingNotifs(true);
      const res = await fetch('/api/v1/notifications?limit=15');
      if (res.ok) {
        const json = await res.json();
        setNotifications(json.data || []);
      }
    } finally {
      setLoadingNotifs(false);
    }
  }, []);

  // Poll and Listen to Real-Time SSE
  useEffect(() => {
    fetchUnreadCount();

    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource('/api/v1/notifications/stream');
      eventSource.onmessage = () => {
        fetchUnreadCount();
        fetchNotifications();
      };
      eventSource.onerror = () => {
        // EventSource will automatically retry connection
      };
    } catch {
      // Fallback to periodic poll if SSE unsupported
      const interval = setInterval(fetchUnreadCount, 30000);
      return () => clearInterval(interval);
    }

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [fetchUnreadCount, fetchNotifications]);

  const handleOpenNotifications = () => {
    const next = !notifOpen;
    setNotifOpen(next);
    if (next) {
      fetchNotifications();
    }
  };

  const handleMarkRead = async (id: string, link: string | null) => {
    try {
      await fetch(`/api/v1/notifications/${id}/read`, { method: 'PATCH' });
      setUnreadCount(prev => Math.max(0, prev - 1));
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
      );
      if (link) {
        setNotifOpen(false);
        router.push(link);
      }
    } catch {
      // Ignore
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await fetch('/api/v1/notifications/read-all', { method: 'POST' });
      setUnreadCount(0);
      setNotifications(prev =>
        prev.map(n => ({ ...n, readAt: new Date().toISOString() })),
      );
    } catch {
      // Ignore
    }
  };

  const handleLogout = async () => {
    try {
      setLoggingOut(true);
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      router.push('/login');
      router.refresh();
    } catch {
      router.push('/login');
    } finally {
      setLoggingOut(false);
    }
  };

  const initials = userEmail
    .split('@')[0]!
    .slice(0, 2)
    .toUpperCase();

  return (
    <header
      style={{
        height: '64px',
        position: 'sticky',
        top: 0,
        backgroundColor: 'var(--surface, #FFFFFF)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 2rem',
        zIndex: 30,
      }}
    >
      {/* Global Search Bar Trigger */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.625rem',
          backgroundColor: 'var(--brand-soft, #F3F7EC)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          padding: '0.4rem 0.75rem',
          width: '320px',
          color: 'var(--text-muted)',
          fontSize: '0.8125rem',
        }}
      >
        <Search size={16} />
        <span style={{ flex: 1 }}>Search employees, org, settings...</span>
        <kbd
          style={{
            backgroundColor: 'var(--border)',
            padding: '0.125rem 0.375rem',
            borderRadius: '4px',
            fontSize: '0.6875rem',
            color: 'var(--text-secondary)',
          }}
        >
          Ctrl K
        </kbd>
      </div>

      {/* Right Actions: Notifications & User Menu */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', position: 'relative' }}>
        {/* Notification Bell */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={handleOpenNotifications}
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--brand-soft, #F3F7EC)',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              position: 'relative',
            }}
            title="Notifications"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: '-4px',
                  right: '-4px',
                  minWidth: '18px',
                  height: '18px',
                  borderRadius: '9999px',
                  backgroundColor: 'var(--danger)',
                  color: '#ffffff',
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0 4px',
                  border: '2px solid #FFFFFF',
                }}
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {/* Notification Popover Dropdown */}
          {notifOpen && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: '46px',
                width: '360px',
                maxHeight: '480px',
                backgroundColor: 'var(--surface, #FFFFFF)',
                border: '1px solid var(--border)',
                borderRadius: '16px',
                boxShadow: '0 12px 32px rgba(0, 75, 42, 0.12)',
                display: 'flex',
                flexDirection: 'column',
                zIndex: 50,
                overflow: 'hidden',
              }}
            >
              {/* Popover Header */}
              <div
                style={{
                  padding: '0.875rem 1rem',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Bell size={16} color="var(--brand-primary, #004B2A)" />
                  <span style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Notifications
                  </span>
                  {unreadCount > 0 && (
                    <span
                      style={{
                        fontSize: '0.6875rem',
                        fontWeight: 600,
                        backgroundColor: 'var(--brand-light, #E8F0D9)',
                        color: 'var(--brand-primary, #004B2A)',
                        padding: '0.125rem 0.5rem',
                        borderRadius: '9999px',
                      }}
                    >
                      {unreadCount} unread
                    </span>
                  )}
                </div>

                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.25rem',
                      fontWeight: 600,
                    }}
                  >
                    <CheckCheck size={14} /> Mark all read
                  </button>
                )}
              </div>

              {/* Notification List */}
              <div style={{ flex: 1, overflowY: 'auto', maxHeight: '340px' }}>
                {loadingNotifs && notifications.length === 0 ? (
                  <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                    Loading notifications...
                  </div>
                ) : notifications.length === 0 ? (
                  <div style={{ padding: '2.5rem 1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                    No notifications yet. You are completely caught up!
                  </div>
                ) : (
                  notifications.map(n => {
                    const isUnread = !n.readAt;
                    return (
                      <div
                        key={n.id}
                        onClick={() => handleMarkRead(n.id, n.link)}
                        style={{
                          padding: '0.75rem 1rem',
                          borderBottom: '1px solid var(--border)',
                          backgroundColor: isUnread ? 'var(--brand-soft, #F3F7EC)' : 'transparent',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '0.75rem',
                          transition: 'background-color 0.15s',
                        }}
                      >
                        <div
                          style={{
                            width: '8px',
                            height: '8px',
                            borderRadius: '50%',
                            backgroundColor: isUnread ? 'var(--brand-secondary, #73992A)' : 'transparent',
                            marginTop: '0.35rem',
                            flexShrink: 0,
                          }}
                        />
                        <div style={{ flex: 1 }}>
                          <div
                            style={{
                              fontSize: '0.8125rem',
                              fontWeight: isUnread ? 700 : 500,
                              color: 'var(--text-primary)',
                              marginBottom: '0.125rem',
                            }}
                          >
                            {n.title}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                            {n.body}
                          </div>
                          <div
                            style={{
                              fontSize: '0.6875rem',
                              color: 'var(--text-muted)',
                              marginTop: '0.25rem',
                              fontFamily: 'monospace',
                            }}
                          >
                            {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Popover Footer */}
              <div
                style={{
                  padding: '0.625rem 1rem',
                  borderTop: '1px solid var(--border)',
                  backgroundColor: 'var(--brand-soft, #F3F7EC)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '0.75rem',
                }}
              >
                <Link
                  href="/settings/notifications"
                  onClick={() => setNotifOpen(false)}
                  style={{
                    color: 'var(--brand-primary, #004B2A)',
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.375rem',
                    fontWeight: 600,
                  }}
                >
                  <Settings size={14} /> Preferences
                </Link>
                <button
                  type="button"
                  onClick={() => setNotifOpen(false)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>

        {/* User Profile Pill */}
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              backgroundColor: 'var(--brand-soft, #F3F7EC)',
              border: '1px solid var(--border)',
              borderRadius: '9999px',
              padding: '0.3rem 0.875rem 0.3rem 0.4rem',
              color: 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            <div
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                backgroundColor: 'var(--brand-primary, #004B2A)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.75rem',
                fontWeight: 700,
                color: '#fff',
              }}
            >
              {initials}
            </div>
            <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '0.8125rem', fontWeight: 600 }}>{userEmail}</span>
              <span style={{ fontSize: '0.6875rem', color: 'var(--brand-secondary, #73992A)', fontWeight: 600 }}>{roleName}</span>
            </div>
            <ChevronDown size={14} color="var(--text-muted)" />
          </button>

          {/* User Menu Dropdown */}
          {menuOpen && (
            <div
              style={{
                position: 'absolute',
                right: 0,
                top: '46px',
                width: '220px',
                backgroundColor: 'var(--surface, #FFFFFF)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                padding: '0.5rem',
                boxShadow: '0 12px 32px rgba(0, 75, 42, 0.12)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.25rem',
                zIndex: 40,
              }}
            >
              <div
                style={{
                  padding: '0.5rem 0.75rem',
                  borderBottom: '1px solid var(--border)',
                  marginBottom: '0.25rem',
                }}
              >
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Signed in as</div>
                <div
                  style={{
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {userEmail}
                </div>
              </div>

              <Link
                href="/security"
                onClick={() => setMenuOpen(false)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '6px',
                  color: 'var(--text-secondary)',
                  textDecoration: 'none',
                  fontSize: '0.8125rem',
                }}
              >
                <ShieldAlert size={16} />
                <span>Security & MFA</span>
              </Link>

              <Link
                href="/settings/notifications"
                onClick={() => setMenuOpen(false)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '6px',
                  color: 'var(--text-secondary)',
                  textDecoration: 'none',
                  fontSize: '0.8125rem',
                }}
              >
                <Settings size={16} />
                <span>Notification Settings</span>
              </Link>

              <div
                style={{
                  height: '1px',
                  backgroundColor: 'var(--border)',
                  margin: '0.25rem 0',
                }}
              />

              <button
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.5rem 0.75rem',
                  borderRadius: '6px',
                  color: 'var(--danger)',
                  backgroundColor: 'transparent',
                  border: 'none',
                  fontSize: '0.8125rem',
                  cursor: 'pointer',
                  width: '100%',
                  textAlign: 'left',
                }}
              >
                <LogOut size={16} />
                <span>{loggingOut ? 'Signing out...' : 'Sign out'}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
