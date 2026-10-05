'use client';

import React, { useState, useEffect, useCallback, useTransition } from 'react';
import {
  Megaphone,
  Pin,
  CheckCircle2,
  Plus,
  RefreshCw,
  Eye,
  X,
  Send,
  Building,
  Globe,
} from 'lucide-react';

interface Announcement {
  id: string;
  title: string;
  contentMd: string;
  audienceType: 'all' | 'department' | 'location';
  isPinned: boolean;
  publishedAt: string;
  expiresAt?: string | null;
  isRead?: boolean;
  readAt?: string | null;
  createdAt: string;
}

export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [filterTab, setFilterTab] = useState<'all' | 'pinned' | 'unread'>('all');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  // Create form state
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newAudience, setNewAudience] = useState<'all' | 'department' | 'location'>('all');
  const [newIsPinned, setNewIsPinned] = useState(false);

  const fetchAnnouncements = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/v1/announcements');
      if (res.ok) {
        const json = await res.json();
        setAnnouncements(json.data || []);
      }
    } catch (err) {
      console.error('Failed to load announcements', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAnnouncements();
  }, [fetchAnnouncements]);

  const handleOpenAnnouncement = async (item: Announcement) => {
    setSelectedAnnouncement(item);
    if (!item.isRead) {
      try {
        await fetch(`/api/v1/announcements/${item.id}/read`, { method: 'POST' });
        setAnnouncements(prev =>
          prev.map(a => (a.id === item.id ? { ...a, isRead: true, readAt: new Date().toISOString() } : a))
        );
      } catch (err) {
        console.error('Failed to mark read', err);
      }
    }
  };

  const handleCreateAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    startTransition(async () => {
      try {
        const res = await fetch('/api/v1/announcements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: newTitle,
            contentMd: newContent,
            audienceType: newAudience,
            isPinned: newIsPinned,
          }),
        });

        if (res.ok) {
          setIsCreateModalOpen(false);
          setNewTitle('');
          setNewContent('');
          setNewAudience('all');
          setNewIsPinned(false);
          await fetchAnnouncements();
        } else {
          const errJson = await res.json().catch(() => ({}));
          setFormError(errJson.error?.message || 'Failed to post announcement');
        }
      } catch {
        setFormError('Network error while posting announcement');
      }
    });
  };

  const filteredAnnouncements = announcements.filter(item => {
    if (filterTab === 'pinned') return item.isPinned;
    if (filterTab === 'unread') return !item.isRead;
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Top Banner & Actions */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              margin: 0,
            }}
          >
            <Megaphone size={28} color="var(--primary-color)" />
            Company Announcements
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: '0.25rem 0 0 0' }}>
            Broadcasts, policy updates, company milestones, and departmental notices
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            onClick={() => fetchAnnouncements()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 0.875rem',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--border-radius-md)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '0.875rem',
            }}
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            Refresh
          </button>

          <button
            onClick={() => setIsCreateModalOpen(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              backgroundColor: 'var(--primary-color)',
              color: 'var(--text-on-primary, #ffffff)',
              border: 'none',
              borderRadius: 'var(--border-radius-md)',
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            <Plus size={16} />
            Post Announcement
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
        {(['all', 'pinned', 'unread'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setFilterTab(tab)}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: 'var(--border-radius-md)',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
              border: 'none',
              backgroundColor: filterTab === tab ? 'var(--primary-color)' : 'transparent',
              color: filterTab === tab ? 'var(--text-on-primary, #ffffff)' : 'var(--text-secondary)',
              textTransform: 'capitalize',
            }}
          >
            {tab} {tab === 'pinned' ? `(${announcements.filter(a => a.isPinned).length})` : tab === 'unread' ? `(${announcements.filter(a => !a.isRead).length})` : `(${announcements.length})`}
          </button>
        ))}
      </div>

      {/* Content Feed */}
      {isLoading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 0.75rem auto' }} />
          Loading announcements...
        </div>
      ) : filteredAnnouncements.length === 0 ? (
        <div
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--border-radius-lg)',
            padding: '4rem 2rem',
            textAlign: 'center',
          }}
        >
          <Megaphone size={40} style={{ color: 'var(--text-secondary)', opacity: 0.5, margin: '0 auto 1rem auto' }} />
          <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-primary)' }}>No announcements found</h3>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            There are no announcements currently matching this filter.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '1.25rem' }}>
          {filteredAnnouncements.map(item => (
            <div
              key={item.id}
              onClick={() => handleOpenAnnouncement(item)}
              style={{
                backgroundColor: 'var(--bg-secondary)',
                border: item.isPinned ? '1px solid var(--primary-color)' : '1px solid var(--border-color)',
                borderRadius: 'var(--border-radius-lg)',
                padding: '1.25rem',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '1rem',
                position: 'relative',
                transition: 'transform 0.15s ease, box-shadow 0.15s ease',
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {item.isPinned && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          backgroundColor: 'var(--color-warning-subtle, rgba(234, 179, 8, 0.15))',
                          color: 'var(--color-warning, var(--warning))',
                          padding: '0.2rem 0.5rem',
                          borderRadius: 'var(--border-radius-sm)',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                        }}
                      >
                        <Pin size={12} />
                        PINNED
                      </span>
                    )}

                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        backgroundColor: 'var(--bg-primary)',
                        color: 'var(--text-secondary)',
                        padding: '0.2rem 0.5rem',
                        borderRadius: 'var(--border-radius-sm)',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                      }}
                    >
                      {item.audienceType === 'all' ? <Globe size={12} /> : <Building size={12} />}
                      {item.audienceType === 'all' ? 'All Staff' : 'Department'}
                    </span>
                  </div>

                  {!item.isRead ? (
                    <span
                      title="Unread announcement"
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--primary)',
                        flexShrink: 0,
                      }}
                    />
                  ) : (
                    <span title="Read" style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}>
                      <CheckCircle2 size={14} color="var(--success)" />
                    </span>
                  )}
                </div>

                <h3
                  style={{
                    fontSize: '1.125rem',
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    margin: '0.75rem 0 0.5rem 0',
                    lineHeight: 1.4,
                  }}
                >
                  {item.title}
                </h3>

                <p
                  style={{
                    color: 'var(--text-secondary)',
                    fontSize: '0.875rem',
                    lineHeight: 1.5,
                    margin: 0,
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {item.contentMd}
                </p>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '0.75rem',
                  color: 'var(--text-secondary)',
                  borderTop: '1px solid var(--border-color)',
                  paddingTop: '0.75rem',
                }}
              >
                <span>{new Date(item.publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--primary-color)', fontWeight: 600 }}>
                  <Eye size={14} />
                  Read full
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reader Modal */}
      {selectedAnnouncement && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '1rem',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-primary)',
              borderRadius: 'var(--border-radius-lg)',
              border: '1px solid var(--border-color)',
              maxWidth: '680px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '2rem',
              position: 'relative',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            }}
          >
            <button
              onClick={() => setSelectedAnnouncement(null)}
              style={{
                position: 'absolute',
                top: '1.25rem',
                right: '1.25rem',
                background: 'none',
                border: 'none',
                color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              <X size={20} />
            </button>

            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
              {selectedAnnouncement.isPinned && (
                <span
                  style={{
                    backgroundColor: 'rgba(234, 179, 8, 0.15)',
                    color: '#ca8a04',
                    padding: '0.2rem 0.5rem',
                    borderRadius: 'var(--border-radius-sm)',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                  }}
                >
                  PINNED
                </span>
              )}
              <span
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-secondary)',
                  padding: '0.2rem 0.5rem',
                  borderRadius: 'var(--border-radius-sm)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                }}
              >
                Published {new Date(selectedAnnouncement.publishedAt).toLocaleDateString()}
              </span>
            </div>

            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 1.5rem 0' }}>
              {selectedAnnouncement.title}
            </h2>

            <div
              style={{
                color: 'var(--text-primary)',
                fontSize: '0.95rem',
                lineHeight: 1.7,
                whiteSpace: 'pre-wrap',
                backgroundColor: 'var(--bg-secondary)',
                padding: '1.25rem',
                borderRadius: 'var(--border-radius-md)',
                border: '1px solid var(--border-color)',
              }}
            >
              {selectedAnnouncement.contentMd}
            </div>

            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setSelectedAnnouncement(null)}
                style={{
                  padding: '0.5rem 1.25rem',
                  backgroundColor: 'var(--primary-color)',
                  color: 'var(--text-on-primary, #ffffff)',
                  border: 'none',
                  borderRadius: 'var(--border-radius-md)',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Announcement Modal */}
      {isCreateModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '1rem',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-primary)',
              borderRadius: 'var(--border-radius-lg)',
              border: '1px solid var(--border-color)',
              maxWidth: '600px',
              width: '100%',
              padding: '2rem',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                Create Company Announcement
              </h2>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            {formError && (
              <div
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  color: '#dc2626',
                  padding: '0.75rem',
                  borderRadius: 'var(--border-radius-md)',
                  fontSize: '0.875rem',
                  marginBottom: '1rem',
                }}
              >
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateAnnouncement} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>
                  Announcement Title
                </label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="e.g. Annual Company Offsite 2026"
                  style={{
                    width: '100%',
                    padding: '0.625rem 0.875rem',
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--border-radius-md)',
                    color: 'var(--text-primary)',
                    fontSize: '0.875rem',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>
                  Target Audience
                </label>
                <select
                  value={newAudience}
                  onChange={e => setNewAudience(e.target.value as 'all' | 'department' | 'location')}
                  style={{
                    width: '100%',
                    padding: '0.625rem 0.875rem',
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--border-radius-md)',
                    color: 'var(--text-primary)',
                    fontSize: '0.875rem',
                  }}
                >
                  <option value="all">Entire Company (All Staff)</option>
                  <option value="department">Specific Department</option>
                  <option value="location">Specific Work Location</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>
                  Message Content (Markdown supported)
                </label>
                <textarea
                  required
                  rows={6}
                  value={newContent}
                  onChange={e => setNewContent(e.target.value)}
                  placeholder="Write announcement body..."
                  style={{
                    width: '100%',
                    padding: '0.625rem 0.875rem',
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--border-radius-md)',
                    color: 'var(--text-primary)',
                    fontSize: '0.875rem',
                    resize: 'vertical',
                  }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  id="pinCheck"
                  checked={newIsPinned}
                  onChange={e => setNewIsPinned(e.target.checked)}
                />
                <label htmlFor="pinCheck" style={{ fontSize: '0.875rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                  Pin this announcement to the top of staff feeds
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  style={{
                    padding: '0.5rem 1rem',
                    backgroundColor: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--border-radius-md)',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem 1.25rem',
                    backgroundColor: 'var(--primary-color)',
                    color: 'var(--text-on-primary, #ffffff)',
                    border: 'none',
                    borderRadius: 'var(--border-radius-md)',
                    fontWeight: 600,
                    cursor: isPending ? 'not-allowed' : 'pointer',
                  }}
                >
                  <Send size={16} />
                  {isPending ? 'Publishing...' : 'Publish'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
