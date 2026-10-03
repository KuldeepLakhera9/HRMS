'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  UploadCloud,
  CheckCircle,
  AlertTriangle,
  Download,
  ArrowRight,
  ArrowLeft,
  RefreshCw,
  FileCheck2,
} from 'lucide-react';

interface PreviewRow {
  rowNumber: number;
  empCode?: string;
  firstName?: string;
  lastName?: string;
  emailWork?: string;
  status: 'valid' | 'error';
  [key: string]: unknown;
}

interface RowError {
  row: number;
  empCode?: string;
  column?: string;
  message: string;
  value?: unknown;
}

const SAMPLE_CSV = `empCode,firstName,lastName,emailWork,phone,gender,dob,doj,employmentType,status,pan,aadhaar
EMP001,John,Doe,john.doe@company.com,9876543210,male,1990-05-15,2023-01-10,full_time,active,ABCDE1234F,123456789012
EMP002,Jane,Smith,jane.smith@company.com,9876543211,female,1992-08-20,2023-02-01,full_time,active,FGHIJ5678K,234567890123
EMP003,Alex,Taylor,alex.taylor@company.com,9876543212,other,1995-11-12,2023-03-15,contract,active,KLMNO9012P,345678901234`;

export default function BulkImportPage() {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [csvContent, setCsvContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [validating, setValidating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [jobId, setJobId] = useState('');
  const [totalRows, setTotalRows] = useState(0);
  const [validRows, setValidRows] = useState(0);
  const [errorRows, setErrorRows] = useState(0);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [errors, setErrors] = useState<RowError[]>([]);
  const [importResult, setImportResult] = useState<{ processed: number; errors: number } | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = evt => {
      const text = evt.target?.result as string;
      setCsvContent(text);
    };
    reader.readAsText(file);
  };

  const handleValidate = async () => {
    if (!csvContent.trim()) {
      setApiError('Please select or paste CSV content before proceeding.');
      return;
    }

    setValidating(true);
    setApiError(null);

    try {
      const res = await fetch('/api/v1/employees/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvContent, entity: 'employee' }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || 'Failed to validate CSV');
      }

      setJobId(json.data.jobId);
      setTotalRows(json.data.totalRows);
      setValidRows(json.data.validRows);
      setErrorRows(json.data.errorRows);
      setPreviewRows(json.data.previewRows || []);
      setErrors(json.data.errors || []);
      setStep(2);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : String(err));
    } finally {
      setValidating(false);
    }
  };

  const handleConfirm = async () => {
    if (!jobId) return;

    setConfirming(true);
    setApiError(null);

    try {
      const res = await fetch(`/api/v1/employees/import/${jobId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: jobId, csvContent }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || 'Failed to execute import');
      }

      setImportResult({
        processed: json.data.processed,
        errors: json.data.errors,
      });
      setStep(3);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirming(false);
    }
  };

  const downloadSampleCsv = () => {
    const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'employee_import_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadErrorCsv = async () => {
    if (!jobId) return;
    try {
      const res = await fetch(`/api/v1/employees/import/${jobId}/errors`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `import_errors_${jobId}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Failed to download error CSV.');
    }
  };

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
          <Link href="/employees" style={{ color: '#818cf8', textDecoration: 'none', fontSize: '0.8125rem', fontWeight: 600 }}>
            ← BACK TO DIRECTORY
          </Link>
        </div>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
          Bulk Employee Import & Upsert
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Upload CSV with per-row validation preview, batched atomic upserts, and downloadable error logs.
        </p>
      </div>

      {/* Stepper Indicator */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          marginBottom: '2rem',
          padding: '1rem',
          borderRadius: '8px',
          backgroundColor: 'rgba(30, 41, 59, 0.5)',
          border: '1px solid var(--border-color)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              backgroundColor: step >= 1 ? 'var(--primary)' : 'rgba(255,255,255,0.1)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '0.8125rem',
            }}
          >
            1
          </span>
          <span style={{ fontWeight: step === 1 ? 700 : 500, color: step >= 1 ? '#fff' : 'var(--text-muted)', fontSize: '0.875rem' }}>
            Upload CSV
          </span>
        </div>

        <div style={{ flex: 1, height: '2px', backgroundColor: step >= 2 ? 'var(--primary)' : 'rgba(255,255,255,0.1)' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              backgroundColor: step >= 2 ? 'var(--primary)' : 'rgba(255,255,255,0.1)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '0.8125rem',
            }}
          >
            2
          </span>
          <span style={{ fontWeight: step === 2 ? 700 : 500, color: step >= 2 ? '#fff' : 'var(--text-muted)', fontSize: '0.875rem' }}>
            Validation Preview
          </span>
        </div>

        <div style={{ flex: 1, height: '2px', backgroundColor: step >= 3 ? 'var(--primary)' : 'rgba(255,255,255,0.1)' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '50%',
              backgroundColor: step >= 3 ? 'var(--success)' : 'rgba(255,255,255,0.1)',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '0.8125rem',
            }}
          >
            3
          </span>
          <span style={{ fontWeight: step === 3 ? 700 : 500, color: step >= 3 ? '#fff' : 'var(--text-muted)', fontSize: '0.875rem' }}>
            Execution Complete
          </span>
        </div>
      </div>

      {apiError && (
        <div
          style={{
            padding: '1rem',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid var(--danger)',
            borderRadius: '8px',
            color: 'var(--danger)',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
          <AlertTriangle size={18} />
          <span>{apiError}</span>
        </div>
      )}

      {/* STEP 1: Upload CSV */}
      {step === 1 && (
        <div className="glass-panel" style={{ padding: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 700, color: '#fff' }}>Upload Employee Master CSV</h2>
            <button
              type="button"
              onClick={downloadSampleCsv}
              className="btn btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem' }}
            >
              <Download size={14} />
              <span>Download Template</span>
            </button>
          </div>

          {/* Drag & Drop Box */}
          <div
            style={{
              border: '2px dashed var(--border-color)',
              borderRadius: '12px',
              padding: '2.5rem',
              textAlign: 'center',
              backgroundColor: 'rgba(15, 23, 42, 0.4)',
              cursor: 'pointer',
              marginBottom: '1.5rem',
            }}
            onClick={() => document.getElementById('file-upload')?.click()}
          >
            <input
              id="file-upload"
              type="file"
              accept=".csv"
              style={{ display: 'none' }}
              onChange={handleFileUpload}
            />
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: 'rgba(99, 102, 241, 0.15)',
                color: 'var(--primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 1rem auto',
              }}
            >
              <UploadCloud size={24} />
            </div>
            <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#fff', marginBottom: '0.25rem' }}>
              {fileName ? fileName : 'Click to browse or drop CSV file here'}
            </div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
              Supports RFC-4180 standard CSV, up to 10MB per batch
            </div>
          </div>

          {/* Direct CSV Textarea Fallback */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
              Or Paste CSV Data Directly:
            </label>
            <textarea
              rows={8}
              value={csvContent}
              onChange={e => setCsvContent(e.target.value)}
              placeholder="empCode,firstName,lastName,emailWork..."
              style={{
                width: '100%',
                padding: '0.75rem',
                borderRadius: '8px',
                backgroundColor: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid var(--border-color)',
                color: '#fff',
                fontFamily: 'monospace',
                fontSize: '0.8125rem',
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={handleValidate}
              disabled={validating || !csvContent.trim()}
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              {validating ? <RefreshCw size={16} className="animate-spin" /> : <ArrowRight size={16} />}
              <span>{validating ? 'Validating CSV Rows...' : 'Validate CSV Rows'}</span>
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: Validation Preview */}
      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Summary KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            <div className="glass-panel" style={{ padding: '1rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>TOTAL ROWS</span>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fff' }}>{totalRows}</div>
            </div>
            <div className="glass-panel" style={{ padding: '1rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--success)', fontWeight: 600 }}>VALID ROWS</span>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--success)' }}>{validRows}</div>
            </div>
            <div className="glass-panel" style={{ padding: '1rem' }}>
              <span style={{ fontSize: '0.75rem', color: errorRows > 0 ? 'var(--danger)' : 'var(--text-muted)', fontWeight: 600 }}>
                ERROR ROWS
              </span>
              <div style={{ fontSize: '1.5rem', fontWeight: 800, color: errorRows > 0 ? 'var(--danger)' : '#fff' }}>
                {errorRows}
              </div>
            </div>
          </div>

          {/* Error Summary Banner (if any) */}
          {errorRows > 0 && (
            <div className="glass-panel" style={{ padding: '1.25rem', borderLeft: '4px solid var(--danger)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <AlertTriangle size={18} color="var(--danger)" />
                  <span style={{ fontWeight: 700, color: '#fff' }}>
                    {errors.length} validation {errors.length === 1 ? 'error' : 'errors'} detected
                  </span>
                </div>
                <button
                  type="button"
                  onClick={downloadErrorCsv}
                  className="btn btn-secondary"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem' }}
                >
                  <Download size={14} />
                  <span>Download Error CSV</span>
                </button>
              </div>

              <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                <table style={{ width: '100%', fontSize: '0.8125rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ color: 'var(--text-muted)', textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                      <th style={{ padding: '0.5rem' }}>Row</th>
                      <th style={{ padding: '0.5rem' }}>Emp Code</th>
                      <th style={{ padding: '0.5rem' }}>Column</th>
                      <th style={{ padding: '0.5rem' }}>Error Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {errors.slice(0, 10).map((err, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <td style={{ padding: '0.5rem', color: 'var(--danger)' }}>#{err.row}</td>
                        <td style={{ padding: '0.5rem' }}>{err.empCode || '-'}</td>
                        <td style={{ padding: '0.5rem', color: '#818cf8' }}>{err.column || 'general'}</td>
                        <td style={{ padding: '0.5rem', color: 'var(--text-secondary)' }}>{err.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Preview Table */}
          <div className="glass-panel" style={{ padding: '1.25rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', marginBottom: '1rem' }}>
              Preview (Showing First {previewRows.length} Rows)
            </h3>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: '0.8125rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ color: 'var(--text-muted)', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>
                    <th style={{ padding: '0.5rem' }}>Row</th>
                    <th style={{ padding: '0.5rem' }}>Status</th>
                    <th style={{ padding: '0.5rem' }}>Emp Code</th>
                    <th style={{ padding: '0.5rem' }}>Name</th>
                    <th style={{ padding: '0.5rem' }}>Work Email</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '0.5rem' }}>#{r.rowNumber}</td>
                      <td style={{ padding: '0.5rem' }}>
                        <span
                          style={{
                            padding: '0.2rem 0.5rem',
                            borderRadius: '4px',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            backgroundColor: r.status === 'valid' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                            color: r.status === 'valid' ? 'var(--success)' : 'var(--danger)',
                          }}
                        >
                          {r.status.toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: '0.5rem', fontWeight: 600 }}>{String(r.empCode || '-')}</td>
                      <td style={{ padding: '0.5rem' }}>{`${String(r.firstName || '')} ${String(r.lastName || '')}`.trim() || '-'}</td>
                      <td style={{ padding: '0.5rem' }}>{String(r.emailWork || '-')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Action Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="btn btn-secondary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              <ArrowLeft size={16} />
              <span>Back to Upload</span>
            </button>

            <button
              type="button"
              onClick={handleConfirm}
              disabled={confirming || validRows === 0}
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
            >
              {confirming ? <RefreshCw size={16} className="animate-spin" /> : <FileCheck2 size={16} />}
              <span>{confirming ? 'Executing Batched Upsert...' : `Confirm & Upsert ${validRows} Records`}</span>
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Execution Complete */}
      {step === 3 && (
        <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              backgroundColor: 'rgba(16, 185, 129, 0.15)',
              color: 'var(--success)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1.5rem auto',
            }}
          >
            <CheckCircle size={36} />
          </div>

          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fff', marginBottom: '0.5rem' }}>
            Bulk Import Completed Successfully
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9375rem', marginBottom: '2rem' }}>
            Processed {importResult?.processed} employee records inside transaction with encrypted sensitive fields and audit logging.
          </p>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
            <Link
              href="/employees"
              className="btn btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none' }}
            >
              <span>View Employee Directory</span>
              <ArrowRight size={16} />
            </Link>
            <button
              type="button"
              onClick={() => {
                setStep(1);
                setCsvContent('');
                setFileName('');
                setJobId('');
                setPreviewRows([]);
                setErrors([]);
                setImportResult(null);
              }}
              className="btn btn-secondary"
            >
              Import Another File
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
