'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  FileEdit,
  CheckCircle,
  XCircle,
  Check,
  X,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { DataTable, type ColumnDef } from '../../../../components/ui/DataTable.js';
import { FormField, Textarea } from '../../../../components/ui/FormKit.js';

interface ChangeRequestItem {
  id: string;
  companyId: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  changes: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy: string | null;
  deciderName: string | null;
  comment: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export default function ChangeRequestsPage() {
  const [requests, setRequests] = useState<ChangeRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected' | ''>('pending');

  // Decision Modal State
  const [activeReq, setActiveReq] = useState<ChangeRequestItem | null>(null);
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      params.set('limit', '50');

      const res = await fetch(`/api/v1/change-requests?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setRequests(json.data || []);
      }
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const handleDecisionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeReq) return;

    setSubmitting(true);
    setDecisionError(null);

    try {
      const endpoint =
        decision === 'approved'
          ? `/api/v1/change-requests/${activeReq.id}/approve`
          : `/api/v1/change-requests/${activeReq.id}/reject`;

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: comment || undefined }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || err.message || 'Failed to submit decision.');
      }

      setActiveReq(null);
      setComment('');
      loadRequests();
    } catch (err: unknown) {
      setDecisionError(err instanceof Error ? err.message : 'Error processing decision.');
    } finally {
      setSubmitting(false);
    }
  };

  const columns: ColumnDef<ChangeRequestItem>[] = [
    {
      id: 'employee',
      header: 'Employee',
      accessorKey: 'employeeName',
      sortable: true,
      cell: row => (
        <Link
          href={`/employees/${row.employeeId}`}
          className="font-semibold text-foreground hover:text-primary transition"
        >
          <div>{row.employeeName}</div>
          <span className="text-[11px] font-mono text-muted-foreground">{row.employeeCode}</span>
        </Link>
      ),
    },
    {
      id: 'changes',
      header: 'Requested Changes',
      cell: row => (
        <div className="space-y-1">
          {Object.entries(row.changes).map(([k, v]) => (
            <div key={k} className="text-xs">
              <span className="font-semibold capitalize text-foreground/80">{k}: </span>
              <span className="text-muted-foreground font-mono">
                {typeof v === 'object' ? JSON.stringify(v) : String(v)}
              </span>
            </div>
          ))}
        </div>
      ),
    },
    {
      id: 'createdAt',
      header: 'Submitted',
      accessorKey: 'createdAt',
      cell: row => (
        <span className="text-muted-foreground font-mono text-xs">
          {new Date(row.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      cell: row => {
        const isApp = row.status === 'approved';
        const isRej = row.status === 'rejected';
        return (
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium capitalize ${
              isApp
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : isRej
                  ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                  : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
            }`}
          >
            {isApp && <CheckCircle className="h-3 w-3" />}
            {isRej && <XCircle className="h-3 w-3" />}
            {row.status}
          </span>
        );
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: row => {
        if (row.status !== 'pending') {
          return (
            <span className="text-[11px] text-muted-foreground italic">
              {row.deciderName ? `Decided by ${row.deciderName}` : 'Resolved'}
            </span>
          );
        }

        return (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setActiveReq(row);
                setDecision('approved');
                setComment('');
                setDecisionError(null);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-emerald-600/10 text-emerald-600 hover:bg-emerald-600 hover:text-white transition"
            >
              <Check className="h-3.5 w-3.5" /> Approve
            </button>
            <button
              onClick={() => {
                setActiveReq(row);
                setDecision('rejected');
                setComment('');
                setDecisionError(null);
              }}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-red-600/10 text-red-600 hover:bg-red-600 hover:text-white transition"
            >
              <X className="h-3.5 w-3.5" /> Reject
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <FileEdit className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Profile Change Requests
            </h1>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Review and approve employee self-service modifications to personal details, addresses, and contacts.
          </p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-border pb-3">
        {(
          [
            { id: 'pending', label: 'Pending Review' },
            { id: 'approved', label: 'Approved' },
            { id: 'rejected', label: 'Rejected' },
            { id: '', label: 'All Requests' },
          ] as const satisfies readonly { id: 'pending' | 'approved' | 'rejected' | ''; label: string }[]
        ).map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setStatusFilter(tab.id)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${
              statusFilter === tab.id
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Table */}
      <DataTable
        columns={columns}
        data={requests}
        loading={loading}
        exportFilename="change_requests.csv"
        emptyTitle="No change requests found"
        emptyDescription="There are no requests matching the current status filter."
      />

      {/* Decision Modal */}
      {activeReq && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground">
                {decision === 'approved' ? 'Approve Change Request' : 'Reject Change Request'}
              </h3>
              <button
                onClick={() => setActiveReq(null)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {decisionError && (
              <div className="p-3 text-xs rounded-lg bg-destructive/10 text-destructive border border-destructive/20 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{decisionError}</span>
              </div>
            )}

            <div className="p-3 rounded-xl border border-border bg-muted/20 text-xs space-y-2">
              <div className="font-semibold text-foreground">
                Employee: {activeReq.employeeName} ({activeReq.employeeCode})
              </div>
              <div className="text-muted-foreground">
                {Object.entries(activeReq.changes).map(([k, v]) => (
                  <div key={k}>
                    • <strong>{k}:</strong> {String(v)}
                  </div>
                ))}
              </div>
            </div>

            <form onSubmit={handleDecisionSubmit} className="space-y-4">
              <FormField
                label="Compliance Comment"
                required={decision === 'rejected'}
                description={
                  decision === 'approved'
                    ? 'Optional reason or note for approval'
                    : 'Mandatory reason explaining why the request is rejected'
                }
              >
                <Textarea
                  required={decision === 'rejected'}
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder={
                    decision === 'approved'
                      ? 'e.g. Verified residential address proof.'
                      : 'e.g. Unverified phone number.'
                  }
                />
              </FormField>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setActiveReq(null)}
                  className="px-4 py-2 text-xs font-semibold rounded-lg border border-border hover:bg-muted/40 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg text-white transition shadow-sm disabled:opacity-50 ${
                    decision === 'approved'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {decision === 'approved' ? 'Confirm Approval' : 'Confirm Rejection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
