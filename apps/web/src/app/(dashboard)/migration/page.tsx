'use client';

import React, { useState, useEffect, useCallback, useTransition } from 'react';
import {
  FileUp,
  Download,
  AlertTriangle,
  RotateCcw,
  RefreshCw,
  Check,
} from 'lucide-react';

interface Batch {
  id: string;
  type: string;
  status: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  createdAt: string;
  revertedAt?: string | null;
}

interface PreviewResult {
  batchId: string;
  type: string;
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: Array<{ rowNumber: number; reason: string; empCode?: string }>;
  preview: Array<Record<string, unknown>>;
}

export default function MigrationPage() {
  const [activeTab, setActiveTab] = useState<'leave' | 'attendance'>('leave');
  const [batches, setBatches] = useState<Batch[]>([]);
  const [csvContent, setCsvContent] = useState<string>('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const loadBatches = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/migration/batches');
      if (res.ok) {
        const json = await res.json();
        setBatches(json.data || []);
      }
    } catch (err) {
      console.error('Failed to load migration batches', err);
    }
  }, []);

  useEffect(() => {
    loadBatches();
  }, [loadBatches]);

  const handleDownloadTemplate = () => {
    let header = '';
    let sample = '';
    let fileName = '';

    if (activeTab === 'leave') {
      header = 'emp_code,leave_type_code,period_year,opening_balance\n';
      sample = 'EMP001,PL,2026,12.5\nEMP002,CL,2026,6.0\n';
      fileName = 'leave_balances_template.csv';
    } else {
      header = 'emp_code,date,in_time,out_time,status\n';
      sample = 'EMP001,2026-06-01,09:15:00,18:30:00,present\nEMP002,2026-06-01,,,absent\n';
      fileName = 'historical_attendance_template.csv';
    }

    const blob = new Blob([header + sample], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePreview = async () => {
    if (!csvContent.trim()) {
      setErrorMsg('Please paste or enter CSV data to preview.');
      return;
    }
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsLoading(true);

    const endpoint = activeTab === 'leave'
      ? '/api/v1/migration/leave-balances/preview'
      : '/api/v1/migration/attendance/preview';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvContent }),
      });

      if (res.ok) {
        const json = await res.json();
        setPreview(json.data);
      } else {
        const errJson = await res.json().catch(() => ({}));
        setErrorMsg(errJson.error?.message || 'Failed to preview CSV');
        setPreview(null);
      }
    } catch {
      setErrorMsg('Network error while previewing CSV data');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    const endpoint = activeTab === 'leave'
      ? '/api/v1/migration/leave-balances/confirm'
      : '/api/v1/migration/attendance/confirm';

    startTransition(async () => {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batchId: preview.batchId }),
        });

        if (res.ok) {
          const json = await res.json();
          setSuccessMsg(`Successfully imported ${json.data?.processedCount || preview.validRows} records!`);
          setPreview(null);
          setCsvContent('');
          await loadBatches();
        } else {
          const errJson = await res.json().catch(() => ({}));
          setErrorMsg(errJson.error?.message || 'Failed to confirm import');
        }
      } catch {
        setErrorMsg('Network error while confirming import');
      }
    });
  };

  const handleRevert = async (batchId: string) => {
    if (!confirm('Are you sure you want to revert this import batch?')) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/v1/migration/batches/${batchId}/revert`, { method: 'POST' });
      if (res.ok) {
        setSuccessMsg('Migration batch reverted successfully.');
        await loadBatches();
      } else {
        const errJson = await res.json().catch(() => ({}));
        setErrorMsg(errJson.error?.message || 'Failed to revert batch');
      }
    } catch {
      setErrorMsg('Network error while reverting batch');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.75rem', margin: 0 }}>
            <FileUp size={28} color="var(--primary-color)" />
            Data Migration & Onboarding Hub
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: '0.25rem 0 0 0' }}>
            Safely import opening leave balances and historical attendance punches with preview, deduplication, and rollback
          </p>
        </div>

        <button
          onClick={handleDownloadTemplate}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 1rem',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--border-radius-md)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontSize: '0.875rem',
            fontWeight: 600,
          }}
        >
          <Download size={16} />
          Download Sample Template
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
        <button
          onClick={() => { setActiveTab('leave'); setPreview(null); setCsvContent(''); }}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: 'var(--border-radius-md)',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: 'pointer',
            border: 'none',
            backgroundColor: activeTab === 'leave' ? 'var(--primary-color)' : 'transparent',
            color: activeTab === 'leave' ? '#ffffff' : 'var(--text-secondary)',
          }}
        >
          Opening Leave Balances
        </button>
        <button
          onClick={() => { setActiveTab('attendance'); setPreview(null); setCsvContent(''); }}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: 'var(--border-radius-md)',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: 'pointer',
            border: 'none',
            backgroundColor: activeTab === 'attendance' ? 'var(--primary-color)' : 'transparent',
            color: activeTab === 'attendance' ? '#ffffff' : 'var(--text-secondary)',
          }}
        >
          Historical Attendance Records
        </button>
      </div>

      {/* Notifications */}
      {errorMsg && (
        <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', color: '#dc2626', padding: '0.75rem 1rem', borderRadius: 'var(--border-radius-md)', fontSize: '0.875rem' }}>
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div style={{ backgroundColor: 'rgba(34, 197, 94, 0.1)', border: '1px solid #22c55e', color: '#16a34a', padding: '0.75rem 1rem', borderRadius: 'var(--border-radius-md)', fontSize: '0.875rem' }}>
          {successMsg}
        </div>
      )}

      {/* CSV Input Card */}
      <div style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--border-radius-lg)', border: '1px solid var(--border-color)', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <label style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Paste CSV Raw Content ({activeTab === 'leave' ? 'emp_code, leave_type_code, period_year, opening_balance' : 'emp_code, date, in_time, out_time, status'}):
        </label>
        <textarea
          rows={6}
          value={csvContent}
          onChange={e => setCsvContent(e.target.value)}
          placeholder={activeTab === 'leave' ? 'EMP001,PL,2026,14.5\nEMP002,CL,2026,6.0' : 'EMP001,2026-06-01,09:15:00,18:30:00,present'}
          style={{
            width: '100%',
            padding: '0.75rem',
            fontFamily: 'monospace',
            fontSize: '0.8125rem',
            backgroundColor: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--border-radius-md)',
            color: 'var(--text-primary)',
            resize: 'vertical',
          }}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <button
            onClick={handlePreview}
            disabled={isLoading || !csvContent.trim()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1.25rem',
              backgroundColor: 'var(--primary-color)',
              color: '#ffffff',
              border: 'none',
              borderRadius: 'var(--border-radius-md)',
              fontWeight: 600,
              fontSize: '0.875rem',
              cursor: isLoading ? 'not-allowed' : 'pointer',
            }}
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            {isLoading ? 'Validating...' : 'Validate & Preview'}
          </button>
        </div>
      </div>

      {/* Preview Card */}
      {preview && (
        <div style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--border-radius-lg)', border: '1px solid var(--border-color)', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>Validation Summary</h2>
              <div style={{ display: 'flex', gap: '1.5rem', marginTop: '0.5rem', fontSize: '0.875rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Total Rows: <strong>{preview.totalRows}</strong></span>
                <span style={{ color: '#16a34a' }}>Valid Rows: <strong>{preview.validRows}</strong></span>
                <span style={{ color: preview.errorRows > 0 ? '#dc2626' : 'var(--text-secondary)' }}>
                  Error Rows: <strong>{preview.errorRows}</strong>
                </span>
              </div>
            </div>

            <button
              onClick={handleConfirm}
              disabled={isPending || preview.validRows === 0}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.625rem 1.5rem',
                backgroundColor: '#16a34a',
                color: '#ffffff',
                border: 'none',
                borderRadius: 'var(--border-radius-md)',
                fontWeight: 700,
                fontSize: '0.875rem',
                cursor: isPending || preview.validRows === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              <Check size={16} />
              {isPending ? 'Importing Data...' : `Confirm Import (${preview.validRows} rows)`}
            </button>
          </div>

          {/* Errors list */}
          {preview.errors.length > 0 && (
            <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 'var(--border-radius-md)', padding: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#dc2626', fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                <AlertTriangle size={16} />
                Identified Validation Issues ({preview.errors.length})
              </div>
              <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8125rem', color: '#dc2626' }}>
                {preview.errors.slice(0, 5).map((err, idx) => (
                  <li key={idx}>Row {err.rowNumber}: {err.reason} {err.empCode ? `(${err.empCode})` : ''}</li>
                ))}
                {preview.errors.length > 5 && <li>...and {preview.errors.length - 5} more issues</li>}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Historical Batches Table */}
      <div style={{ backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--border-radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', fontWeight: 700, fontSize: '0.9375rem', color: 'var(--text-primary)' }}>
          Past Migration Batches
        </div>

        {batches.length === 0 ? (
          <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            No migration batches recorded yet.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-secondary)', fontWeight: 600 }}>
                <th style={{ padding: '0.75rem 1rem' }}>Batch Type</th>
                <th style={{ padding: '0.75rem 1rem' }}>Status</th>
                <th style={{ padding: '0.75rem 1rem' }}>Total Rows</th>
                <th style={{ padding: '0.75rem 1rem' }}>Valid / Imported</th>
                <th style={{ padding: '0.75rem 1rem' }}>Date</th>
                <th style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {batches.map(batch => (
                <tr key={batch.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {batch.type === 'leave_balances' ? 'Opening Leave Balances' : 'Attendance Punches'}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <span
                      style={{
                        padding: '0.2rem 0.6rem',
                        borderRadius: 'var(--border-radius-sm)',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        backgroundColor: batch.status === 'completed' ? 'rgba(34, 197, 94, 0.15)' : batch.status === 'reverted' ? 'rgba(239, 68, 68, 0.15)' : 'var(--bg-primary)',
                        color: batch.status === 'completed' ? '#16a34a' : batch.status === 'reverted' ? '#dc2626' : 'var(--text-secondary)',
                      }}
                    >
                      {batch.status.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: '1rem', color: 'var(--text-secondary)' }}>{batch.totalRows}</td>
                  <td style={{ padding: '1rem', fontWeight: 600, color: '#16a34a' }}>{batch.validRows}</td>
                  <td style={{ padding: '1rem', color: 'var(--text-secondary)' }}>{new Date(batch.createdAt).toLocaleDateString()}</td>
                  <td style={{ padding: '1rem', textAlign: 'right' }}>
                    {batch.status === 'completed' && batch.type === 'leave_balances' && (
                      <button
                        onClick={() => handleRevert(batch.id)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.25rem',
                          padding: '0.3rem 0.6rem',
                          backgroundColor: 'rgba(239, 68, 68, 0.1)',
                          color: '#dc2626',
                          border: 'none',
                          borderRadius: 'var(--border-radius-sm)',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        <RotateCcw size={12} />
                        Revert Batch
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
