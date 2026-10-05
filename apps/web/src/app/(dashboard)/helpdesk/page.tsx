'use client';

import React, { useState, useEffect, useCallback, useTransition } from 'react';
import {
  LifeBuoy,
  Plus,
  RefreshCw,
  Clock,
  MessageSquare,
  Lock,
  ChevronRight,
  Send,
  X,
} from 'lucide-react';

interface Category {
  id: string;
  name: string;
  code: string;
  slaHours: number;
}

interface Ticket {
  id: string;
  ticketNumber: string;
  categoryId: string;
  categoryName?: string;
  subject: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  creatorUserId: string;
  creatorName?: string;
  slaDueAt: string;
  resolvedAt?: string | null;
  createdAt: string;
  commentsCount?: number;
}

interface Comment {
  id: string;
  userId: string;
  userName?: string;
  commentMd: string;
  isInternal: boolean;
  createdAt: string;
}

export default function HelpdeskPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Modal / Drawer state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [ticketComments, setTicketComments] = useState<Comment[]>([]);
  const [isCommentsLoading, setIsCommentsLoading] = useState<boolean>(false);
  const [newCommentText, setNewCommentText] = useState<string>('');
  const [isInternalComment, setIsInternalComment] = useState<boolean>(false);
  const [isPending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);

  // New ticket state
  const [newCategoryId, setNewCategoryId] = useState<string>('');
  const [newSubject, setNewSubject] = useState<string>('');
  const [newDescription, setNewDescription] = useState<string>('');
  const [newPriority, setNewPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [catRes, tickRes] = await Promise.all([
        fetch('/api/v1/helpdesk/categories'),
        fetch('/api/v1/helpdesk'),
      ]);
      if (catRes.ok) {
        const json = await catRes.json();
        setCategories(json.data || []);
        if (json.data && json.data.length > 0 && !newCategoryId) {
          setNewCategoryId(json.data[0].id);
        }
      }
      if (tickRes.ok) {
        const json = await tickRes.json();
        setTickets(json.data || []);
      }
    } catch (err) {
      console.error('Failed to load helpdesk data', err);
    } finally {
      setIsLoading(false);
    }
  }, [newCategoryId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openTicketDrawer = async (ticket: Ticket) => {
    setSelectedTicket(ticket);
    setIsCommentsLoading(true);
    try {
      const res = await fetch(`/api/v1/helpdesk/${ticket.id}`);
      if (res.ok) {
        const json = await res.json();
        setTicketComments(json.data?.comments || []);
      }
    } catch (err) {
      console.error('Failed to fetch ticket comments', err);
    } finally {
      setIsCommentsLoading(false);
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    startTransition(async () => {
      try {
        const res = await fetch('/api/v1/helpdesk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            categoryId: newCategoryId,
            subject: newSubject,
            description: newDescription,
            priority: newPriority,
          }),
        });

        if (res.ok) {
          setIsCreateModalOpen(false);
          setNewSubject('');
          setNewDescription('');
          setNewPriority('medium');
          await loadData();
        } else {
          const errJson = await res.json().catch(() => ({}));
          setFormError(errJson.error?.message || 'Failed to submit ticket');
        }
      } catch {
        setFormError('Network error while submitting ticket');
      }
    });
  };

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !newCommentText.trim()) return;

    startTransition(async () => {
      try {
        const res = await fetch(`/api/v1/helpdesk/${selectedTicket.id}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            commentMd: newCommentText,
            isInternal: isInternalComment,
          }),
        });

        if (res.ok) {
          setNewCommentText('');
          setIsInternalComment(false);
          const refreshRes = await fetch(`/api/v1/helpdesk/${selectedTicket.id}`);
          if (refreshRes.ok) {
            const json = await refreshRes.json();
            setTicketComments(json.data?.comments || []);
          }
        }
      } catch (err) {
        console.error('Failed to add comment', err);
      }
    });
  };

  const handleUpdateStatus = async (status: 'open' | 'in_progress' | 'resolved' | 'closed') => {
    if (!selectedTicket) return;
    try {
      const res = await fetch(`/api/v1/helpdesk/${selectedTicket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        const json = await res.json();
        setSelectedTicket(json.data);
        await loadData();
      }
    } catch (err) {
      console.error('Failed to update status', err);
    }
  };

  const filteredTickets = tickets.filter(t => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false;
    return true;
  });

  const getStatusBadge = (status: Ticket['status']) => {
    switch (status) {
      case 'open':
        return <span style={{ backgroundColor: 'rgba(59, 130, 246, 0.15)', color: '#2563eb', padding: '0.2rem 0.6rem', borderRadius: 'var(--border-radius-sm)', fontSize: '0.75rem', fontWeight: 700 }}>OPEN</span>;
      case 'in_progress':
        return <span style={{ backgroundColor: 'rgba(234, 179, 8, 0.15)', color: '#ca8a04', padding: '0.2rem 0.6rem', borderRadius: 'var(--border-radius-sm)', fontSize: '0.75rem', fontWeight: 700 }}>IN PROGRESS</span>;
      case 'resolved':
        return <span style={{ backgroundColor: 'rgba(34, 197, 94, 0.15)', color: '#16a34a', padding: '0.2rem 0.6rem', borderRadius: 'var(--border-radius-sm)', fontSize: '0.75rem', fontWeight: 700 }}>RESOLVED</span>;
      case 'closed':
        return <span style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-secondary)', padding: '0.2rem 0.6rem', borderRadius: 'var(--border-radius-sm)', fontSize: '0.75rem', fontWeight: 700 }}>CLOSED</span>;
    }
  };

  const getPriorityBadge = (priority: Ticket['priority']) => {
    switch (priority) {
      case 'urgent':
        return <span style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#dc2626', padding: '0.15rem 0.5rem', borderRadius: 'var(--border-radius-sm)', fontSize: '0.75rem', fontWeight: 700 }}>URGENT</span>;
      case 'high':
        return <span style={{ backgroundColor: 'rgba(249, 115, 22, 0.15)', color: '#ea580c', padding: '0.15rem 0.5rem', borderRadius: 'var(--border-radius-sm)', fontSize: '0.75rem', fontWeight: 700 }}>HIGH</span>;
      case 'medium':
        return <span style={{ backgroundColor: 'rgba(59, 130, 246, 0.15)', color: '#2563eb', padding: '0.15rem 0.5rem', borderRadius: 'var(--border-radius-sm)', fontSize: '0.75rem', fontWeight: 600 }}>MEDIUM</span>;
      case 'low':
        return <span style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-secondary)', padding: '0.15rem 0.5rem', borderRadius: 'var(--border-radius-sm)', fontSize: '0.75rem', fontWeight: 600 }}>LOW</span>;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.75rem', margin: 0 }}>
            <LifeBuoy size={28} color="var(--primary-color)" />
            Employee Helpdesk & Support
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: '0.25rem 0 0 0' }}>
            Submit and track IT, HR, facilities, and payroll service requests with guaranteed SLAs
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            onClick={() => loadData()}
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
            New Ticket
          </button>
        </div>
      </div>

      {/* Stats Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '1.25rem', borderRadius: 'var(--border-radius-lg)', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Open Tickets</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#2563eb', marginTop: '0.25rem' }}>
            {tickets.filter(t => t.status === 'open').length}
          </div>
        </div>

        <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '1.25rem', borderRadius: 'var(--border-radius-lg)', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>In Progress</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#ca8a04', marginTop: '0.25rem' }}>
            {tickets.filter(t => t.status === 'in_progress').length}
          </div>
        </div>

        <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '1.25rem', borderRadius: 'var(--border-radius-lg)', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Resolved</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#16a34a', marginTop: '0.25rem' }}>
            {tickets.filter(t => t.status === 'resolved' || t.status === 'closed').length}
          </div>
        </div>

        <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '1.25rem', borderRadius: 'var(--border-radius-lg)', border: '1px solid var(--border-color)' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Standard SLA</div>
          <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '0.25rem' }}>
            24 - 48h
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', backgroundColor: 'var(--bg-secondary)', padding: '1rem', borderRadius: 'var(--border-radius-lg)', border: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Status:</span>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={{ padding: '0.4rem 0.75rem', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-md)', color: 'var(--text-primary)', fontSize: '0.875rem' }}
          >
            <option value="all">All Statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Priority:</span>
          <select
            value={priorityFilter}
            onChange={e => setPriorityFilter(e.target.value)}
            style={{ padding: '0.4rem 0.75rem', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-md)', color: 'var(--text-primary)', fontSize: '0.875rem' }}
          >
            <option value="all">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      {/* Tickets List Table */}
      <div style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--border-radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        {isLoading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 0.75rem auto' }} />
            Loading support tickets...
          </div>
        ) : filteredTickets.length === 0 ? (
          <div style={{ padding: '4rem 2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            <LifeBuoy size={40} style={{ opacity: 0.5, margin: '0 auto 1rem auto' }} />
            <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-primary)' }}>No tickets found</h3>
            <p style={{ margin: 0, fontSize: '0.875rem' }}>You currently have no active support requests matching these filters.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-secondary)', fontWeight: 600 }}>
                <th style={{ padding: '0.75rem 1rem' }}>Ticket #</th>
                <th style={{ padding: '0.75rem 1rem' }}>Category</th>
                <th style={{ padding: '0.75rem 1rem' }}>Subject</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Priority</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Status</th>
                <th style={{ padding: '0.75rem 1rem' }}>SLA Target</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'center' }}>Comments</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredTickets.map(ticket => (
                <tr
                  key={ticket.id}
                  onClick={() => openTicketDrawer(ticket)}
                  style={{
                    borderBottom: '1px solid var(--border-color)',
                    cursor: 'pointer',
                    transition: 'background-color 0.15s ease',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--bg-primary)')}
                  onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <td style={{ padding: '1rem', fontWeight: 700, color: 'var(--primary-color)' }}>{ticket.ticketNumber}</td>
                  <td style={{ padding: '1rem', color: 'var(--text-secondary)' }}>{ticket.categoryName || 'Support'}</td>
                  <td style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>{ticket.subject}</td>
                  <td style={{ padding: '1rem', textAlign: 'center' }}>{getPriorityBadge(ticket.priority)}</td>
                  <td style={{ padding: '1rem', textAlign: 'center' }}>{getStatusBadge(ticket.status)}</td>
                  <td style={{ padding: '1rem', color: 'var(--text-secondary)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                      <Clock size={14} />
                      {new Date(ticket.slaDueAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </td>
                  <td style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                      <MessageSquare size={14} />
                      {ticket.commentsCount || 0}
                    </div>
                  </td>
                  <td style={{ padding: '1rem', textAlign: 'right' }}>
                    <ChevronRight size={16} color="var(--text-secondary)" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Ticket Details Drawer */}
      {selectedTicket && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            justifyContent: 'flex-end',
            zIndex: 100,
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--bg-primary)',
              width: '100%',
              maxWidth: '560px',
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '-4px 0 25px rgba(0, 0, 0, 0.15)',
            }}
          >
            {/* Drawer Header */}
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <span style={{ fontWeight: 800, color: 'var(--primary-color)' }}>{selectedTicket.ticketNumber}</span>
                  {getStatusBadge(selectedTicket.status)}
                  {getPriorityBadge(selectedTicket.priority)}
                </div>
                <h2 style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                  {selectedTicket.subject}
                </h2>
              </div>
              <button onClick={() => setSelectedTicket(null)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            {/* Drawer Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Status Update Actions for Admins/Agents */}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', backgroundColor: 'var(--bg-secondary)', padding: '0.75rem', borderRadius: 'var(--border-radius-md)' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Status:</span>
                {(['open', 'in_progress', 'resolved', 'closed'] as const).map(st => (
                  <button
                    key={st}
                    onClick={() => handleUpdateStatus(st)}
                    style={{
                      padding: '0.25rem 0.6rem',
                      borderRadius: 'var(--border-radius-sm)',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: 'none',
                      backgroundColor: selectedTicket.status === st ? 'var(--primary-color)' : 'var(--bg-primary)',
                      color: selectedTicket.status === st ? '#ffffff' : 'var(--text-secondary)',
                      textTransform: 'capitalize',
                    }}
                  >
                    {st.replace('_', ' ')}
                  </button>
                ))}
              </div>

              {/* Description */}
              <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '1rem', borderRadius: 'var(--border-radius-md)', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>Issue Description</div>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                  {selectedTicket.description}
                </div>
              </div>

              {/* Comments Thread */}
              <div>
                <h3 style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.75rem' }}>
                  Conversation Thread ({ticketComments.length})
                </h3>

                {isCommentsLoading ? (
                  <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading thread...</div>
                ) : ticketComments.length === 0 ? (
                  <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                    No comments posted yet.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {ticketComments.map(comment => (
                      <div
                        key={comment.id}
                        style={{
                          backgroundColor: comment.isInternal ? 'rgba(234, 179, 8, 0.1)' : 'var(--bg-secondary)',
                          border: comment.isInternal ? '1px dashed #ca8a04' : '1px solid var(--border-color)',
                          borderRadius: 'var(--border-radius-md)',
                          padding: '0.875rem',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.375rem' }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                            {comment.userName || 'Staff Member'}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {comment.isInternal && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.7rem', color: '#ca8a04', fontWeight: 700 }}>
                                <Lock size={10} />
                                INTERNAL NOTE
                              </span>
                            )}
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                              {new Date(comment.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                        <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
                          {comment.commentMd}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Comment Input Footer */}
            <form onSubmit={handleAddComment} style={{ padding: '1.25rem 1.5rem', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <input
                  type="checkbox"
                  id="internalCheck"
                  checked={isInternalComment}
                  onChange={e => setIsInternalComment(e.target.checked)}
                />
                <label htmlFor="internalCheck" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  Post as Internal Agent Note (Hidden from employee)
                </label>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  required
                  placeholder="Type a reply or update..."
                  value={newCommentText}
                  onChange={e => setNewCommentText(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '0.625rem 0.875rem',
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--border-radius-md)',
                    color: 'var(--text-primary)',
                    fontSize: '0.875rem',
                  }}
                />
                <button
                  type="submit"
                  disabled={isPending}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.375rem',
                    padding: '0.625rem 1rem',
                    backgroundColor: 'var(--primary-color)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 'var(--border-radius-md)',
                    fontWeight: 600,
                    cursor: isPending ? 'not-allowed' : 'pointer',
                  }}
                >
                  <Send size={14} />
                  Send
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Ticket Modal */}
      {isCreateModalOpen && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1rem' }}>
          <div style={{ backgroundColor: 'var(--bg-primary)', borderRadius: 'var(--border-radius-lg)', border: '1px solid var(--border-color)', maxWidth: '580px', width: '100%', padding: '2rem', boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Submit Support Ticket</h2>
              <button onClick={() => setIsCreateModalOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            {formError && (
              <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#dc2626', padding: '0.75rem', borderRadius: 'var(--border-radius-md)', fontSize: '0.875rem', marginBottom: '1rem' }}>
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateTicket} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>Category</label>
                <select
                  required
                  value={newCategoryId}
                  onChange={e => setNewCategoryId(e.target.value)}
                  style={{ width: '100%', padding: '0.625rem 0.875rem', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-md)', color: 'var(--text-primary)', fontSize: '0.875rem' }}
                >
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name} (SLA: {c.slaHours}h)</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>Priority Level</label>
                <select
                  value={newPriority}
                  onChange={e => setNewPriority(e.target.value as 'low' | 'medium' | 'high' | 'urgent')}
                  style={{ width: '100%', padding: '0.625rem 0.875rem', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-md)', color: 'var(--text-primary)', fontSize: '0.875rem' }}
                >
                  <option value="low">Low (General inquiry)</option>
                  <option value="medium">Medium (Standard request)</option>
                  <option value="high">High (Impacting daily work)</option>
                  <option value="urgent">Urgent (System or access outage)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>Subject</label>
                <input
                  type="text"
                  required
                  value={newSubject}
                  onChange={e => setNewSubject(e.target.value)}
                  placeholder="e.g. Email sync issue on Outlook mobile"
                  style={{ width: '100%', padding: '0.625rem 0.875rem', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-md)', color: 'var(--text-primary)', fontSize: '0.875rem' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.375rem', color: 'var(--text-primary)' }}>Description</label>
                <textarea
                  required
                  rows={5}
                  value={newDescription}
                  onChange={e => setNewDescription(e.target.value)}
                  placeholder="Provide steps to reproduce, device info, error messages..."
                  style={{ width: '100%', padding: '0.625rem 0.875rem', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-md)', color: 'var(--text-primary)', fontSize: '0.875rem', resize: 'vertical' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  style={{ padding: '0.5rem 1rem', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-md)', color: 'var(--text-secondary)', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1.25rem', backgroundColor: 'var(--primary-color)', color: '#ffffff', border: 'none', borderRadius: 'var(--border-radius-md)', fontWeight: 600, cursor: isPending ? 'not-allowed' : 'pointer' }}
                >
                  <Send size={16} />
                  {isPending ? 'Submitting...' : 'Submit Ticket'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
