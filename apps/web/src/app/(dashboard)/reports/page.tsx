'use client';

import React, { useState, useEffect, useCallback, useTransition } from 'react';
import {
  FileSpreadsheet,
  Download,
  Filter,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertCircle,
  Table,
} from 'lucide-react';

interface ReportInfo {
  key: string;
  title: string;
  description: string;
  category: string;
  scopes: string[];
  exports: string[];
}

interface ReportColumn {
  key: string;
  header: string;
  type: string;
  align?: 'left' | 'center' | 'right';
}

interface PreviewData {
  key: string;
  title: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  totalCount: number;
  page: number;
  pageSize: number;
}

interface ReportRunItem {
  id: string;
  reportKey: string;
  status: string;
  rows: number;
  durationMs: number;
  createdAt: string;
  requestedByEmail?: string;
}

export default function ReportsHubPage() {
  const [reports, setReports] = useState<ReportInfo[]>([]);
  const [selectedReportKey, setSelectedReportKey] = useState<string>('attendance_summary');
  const [runs, setRuns] = useState<ReportRunItem[]>([]);
  const [isPending, startTransition] = useTransition();

  // Filter state
  const [period, setPeriod] = useState<string>('2026-08');
  const [startDate, setStartDate] = useState<string>('2026-08-01');
  const [endDate, setEndDate] = useState<string>('2026-08-15');
  const [format, setFormat] = useState<'csv' | 'xlsx'>('csv');

  // Preview state
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    try {
      const [repRes, runsRes] = await Promise.all([
        fetch('/api/v1/reports'),
        fetch('/api/v1/reports/runs'),
      ]);
      if (repRes.ok) {
        const json = await repRes.json();
        setReports(json.data || []);
      }
      if (runsRes.ok) {
        const json = await runsRes.json();
        setRuns(json.data || []);
      }
    } catch (err) {
      console.error('Failed to load reports catalog', err);
    }
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const handleFetchPreview = useCallback(async () => {
    setIsPreviewLoading(true);
    setError(null);
    setExportUrl(null);

    const filters: Record<string, unknown> = {};
    if (selectedReportKey === 'attendance_summary') {
      filters.period = period;
    } else {
      filters.startDate = startDate;
      filters.endDate = endDate;
    }

    try {
      const res = await fetch(`/api/v1/reports/${selectedReportKey}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page: 1,
          pageSize: 50,
          filters,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        setPreview(json.data || null);
      } else {
        const errJson = await res.json().catch(() => ({}));
        setError(errJson.error?.message || 'Failed to generate report preview');
        setPreview(null);
      }
    } catch {
      setError('Network error while fetching report preview');
      setPreview(null);
    } finally {
      setIsPreviewLoading(false);
    }
  }, [selectedReportKey, period, startDate, endDate]);

  useEffect(() => {
    handleFetchPreview();
  }, [handleFetchPreview]);

  const handleExport = async () => {
    startTransition(async () => {
      setError(null);
      const filters: Record<string, unknown> = {};
      if (selectedReportKey === 'attendance_summary') {
        filters.period = period;
      } else {
        filters.startDate = startDate;
        filters.endDate = endDate;
      }

      try {
        const res = await fetch(`/api/v1/reports/${selectedReportKey}/export`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            format,
            filters,
          }),
        });

        if (res.ok) {
          const json = await res.json();
          if (json.data?.downloadUrl) {
            setExportUrl(json.data.downloadUrl);
            window.open(json.data.downloadUrl, '_blank');
          }
          loadReports();
        } else {
          const errJson = await res.json().catch(() => ({}));
          setError(errJson.error?.message || 'Export failed');
        }
      } catch {
        setError('Network error during report export');
      }
    });
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '1.5rem', color: 'var(--text-primary)' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0 }}>
            Reports & Analytics
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
            Synchronous preview and streamed CSV / Excel exports stored securely in MinIO
          </p>
        </div>
      </div>

      {/* Report Selection Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {(reports.length > 0 ? reports : [
          {
            key: 'attendance_summary',
            title: 'Attendance Summary',
            description: 'Aggregated monthly attendance, leaves, late counts, and hours worked',
          },
          {
            key: 'daily_attendance_register',
            title: 'Daily Attendance Register',
            description: 'Employee x day matrix of punch in/out times and duration',
          },
          {
            key: 'late_marks_and_absenteeism',
            title: 'Late Marks & Absenteeism',
            description: 'Detailed log of tardiness, early exits, and unexcused absences',
          },
        ]).map((r) => {
          const isSelected = selectedReportKey === r.key;
          return (
            <div
              key={r.key}
              onClick={() => setSelectedReportKey(r.key)}
              className="glass-panel"
              style={{
                padding: '1.25rem',
                cursor: 'pointer',
                border: isSelected ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.08)' : 'var(--bg-card)',
                transition: 'all 0.2s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <FileSpreadsheet size={18} color="var(--primary)" />
                <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>{r.title}</h3>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>{r.description}</p>
            </div>
          );
        })}
      </div>

      {/* Filter and Export Action Bar */}
      <div className="glass-panel" style={{ padding: '1.25rem', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Filter size={16} color="var(--text-secondary)" />
            <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>Parameters:</span>
          </div>

          {selectedReportKey === 'attendance_summary' ? (
            <div>
              <input
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                style={{
                  padding: '0.45rem 0.75rem',
                  borderRadius: '6px',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                }}
              />
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={{
                  padding: '0.45rem 0.75rem',
                  borderRadius: '6px',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                }}
              />
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>to</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{
                  padding: '0.45rem 0.75rem',
                  borderRadius: '6px',
                  backgroundColor: 'var(--bg-input)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                  fontSize: '0.85rem',
                }}
              />
            </div>
          )}

          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as 'csv' | 'xlsx')}
            style={{
              padding: '0.45rem 0.75rem',
              borderRadius: '6px',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
            }}
          >
            <option value="csv">CSV (.csv)</option>
            <option value="xlsx">Excel (.xlsx)</option>
          </select>

          <button
            onClick={handleFetchPreview}
            disabled={isPreviewLoading}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.45rem 0.85rem',
              borderRadius: '6px',
              backgroundColor: 'var(--bg-input)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            <RefreshCw size={14} className={isPreviewLoading ? 'animate-spin' : ''} />
            Update Preview
          </button>
        </div>

        <button
          onClick={handleExport}
          disabled={isPending}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.55rem 1.25rem',
            borderRadius: '8px',
            backgroundColor: 'var(--primary)',
            color: '#fff',
            border: 'none',
            fontWeight: 600,
            fontSize: '0.875rem',
            cursor: isPending ? 'not-allowed' : 'pointer',
          }}
        >
          <Download size={16} />
          {isPending ? 'Generating Export...' : `Export Full ${format.toUpperCase()}`}
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div style={{ padding: '0.85rem 1rem', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger)', borderRadius: '8px', color: 'var(--danger)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Download Alert */}
      {exportUrl && (
        <div style={{ padding: '0.85rem 1rem', backgroundColor: 'rgba(16, 185, 129, 0.1)', border: '1px solid var(--success)', borderRadius: '8px', color: 'var(--success)', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <CheckCircle2 size={16} />
            <span>Export generated successfully and stored in MinIO storage!</span>
          </div>
          <a
            href={exportUrl}
            target="_blank"
            rel="noreferrer"
            style={{ color: 'var(--success)', fontWeight: 600, textDecoration: 'underline', fontSize: '0.85rem' }}
          >
            Download File Again
          </a>
        </div>
      )}

      {/* Preview Table */}
      <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Table size={18} color="var(--primary)" />
            <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>
              {preview?.title || 'Data Preview'}
            </h2>
          </div>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Showing {preview?.rows?.length || 0} of {preview?.totalCount || 0} matching records
          </span>
        </div>

        {preview && preview.rows.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.825rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                  {preview.columns.map((col) => (
                    <th
                      key={col.key}
                      style={{
                        padding: '0.65rem',
                        textAlign: col.align || 'left',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {col.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    {preview.columns.map((col) => (
                      <td
                        key={col.key}
                        style={{
                          padding: '0.65rem',
                          textAlign: col.align || 'left',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {String(row[col.key] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            {isPreviewLoading ? 'Loading records preview...' : 'No matching records found for specified parameters.'}
          </div>
        )}
      </div>

      {/* Recent Runs History */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <Clock size={18} color="var(--primary)" />
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>Recent Export Runs</h2>
        </div>
        {runs.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.8rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                <th style={{ padding: '0.5rem' }}>Report</th>
                <th style={{ padding: '0.5rem' }}>Status</th>
                <th style={{ padding: '0.5rem' }}>Rows</th>
                <th style={{ padding: '0.5rem' }}>Duration</th>
                <th style={{ padding: '0.5rem' }}>Requested By</th>
                <th style={{ padding: '0.5rem' }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '0.5rem', fontWeight: 500 }}>{run.reportKey}</td>
                  <td style={{ padding: '0.5rem' }}>
                    <span style={{ padding: '0.2rem 0.5rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 600, backgroundColor: run.status === 'done' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)', color: run.status === 'done' ? 'var(--success)' : 'var(--danger)' }}>
                      {run.status.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: '0.5rem' }}>{run.rows}</td>
                  <td style={{ padding: '0.5rem' }}>{run.durationMs}ms</td>
                  <td style={{ padding: '0.5rem', color: 'var(--text-secondary)' }}>{run.requestedByEmail || 'User'}</td>
                  <td style={{ padding: '0.5rem', color: 'var(--text-secondary)' }}>{new Date(run.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            No export runs recorded yet.
          </div>
        )}
      </div>
    </div>
  );
}
