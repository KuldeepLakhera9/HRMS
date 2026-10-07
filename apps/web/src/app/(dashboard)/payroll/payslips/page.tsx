'use client';

import React, { useEffect, useState } from 'react';
import {
  FileText,
  Download,
  Search,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

interface PayslipSummary {
  id: string;
  runId: string;
  employeeId: string;
  employeeName: string;
  empCode: string;
  department: string | null;
  period: string;
  gross: string;
  deductions: string;
  net: string;
  employerCost: string;
  integrityHash: string;
  publishedAt: string | null;
  paymentStatus: string;
}

export default function PayslipsPage() {
  const [payslips, setPayslips] = useState<PayslipSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [periodFilter, setPeriodFilter] = useState('');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [reissuingId, setReissuingId] = useState<string | null>(null);
  const [reissueReason, setReissueReason] = useState('');
  const [showReissueModal, setShowReissueModal] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const fetchPayslips = async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      let url = '/api/v1/payroll/payslips?limit=50';
      if (periodFilter) url += `&period=${encodeURIComponent(periodFilter)}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Failed to load payslips: ${res.statusText}`);
      }
      const data = await res.json();
      setPayslips(data.data || []);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error fetching payslips');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayslips();
  }, [periodFilter]);

  const handleDownload = async (id: string, _empCode?: string, _period?: string) => {
    try {
      setDownloadingId(id);
      const res = await fetch(`/api/v1/payroll/payslips/${id}/download`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Download failed');
      }
      const { data } = await res.json();
      if (data?.downloadUrl) {
        window.open(data.downloadUrl, '_blank');
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to download payslip');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleReissue = async () => {
    if (!reissuingId || !reissueReason.trim()) return;
    try {
      const res = await fetch(`/api/v1/payroll/payslips/${reissuingId}/reissue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: reissuingId, reason: reissueReason }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Reissue failed');
      }
      setActionSuccess('Payslip PDF re-issued and uploaded to vault successfully.');
      setShowReissueModal(false);
      setReissuingId(null);
      setReissueReason('');
      fetchPayslips();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to reissue payslip');
    }
  };

  const filtered = payslips.filter(p => {
    const q = search.toLowerCase();
    return (
      p.employeeName.toLowerCase().includes(q) ||
      p.empCode.toLowerCase().includes(q) ||
      p.period.toLowerCase().includes(q)
    );
  });

  const formatCurrency = (val: string | number) => {
    const num = Number(val);
    if (isNaN(num)) return '₹0.00';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
    }).format(num);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Payslip Vault & Distribution</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Pre-generated immutable payslip documents with SHA-256 integrity verification and audit trails.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchPayslips()}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border border-neutral-300 rounded-md bg-white hover:bg-neutral-50 text-neutral-700 transition"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {actionSuccess && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-md text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            {actionSuccess}
          </span>
          <button onClick={() => setActionSuccess(null)} className="text-emerald-700 hover:text-emerald-900 text-xs">
            Dismiss
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-800 rounded-md text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-600" />
            {errorMsg}
          </span>
          <button onClick={() => setErrorMsg(null)} className="text-red-700 hover:text-red-900 text-xs">
            Dismiss
          </button>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 bg-white p-4 rounded-lg border border-neutral-200 shadow-sm">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-3 text-neutral-400" />
          <input
            type="text"
            placeholder="Search employee by name or code..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-neutral-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#004B2A]"
          />
        </div>
        <div className="sm:w-48">
          <input
            type="text"
            placeholder="Filter YYYY-MM (e.g. 2026-04)"
            value={periodFilter}
            onChange={e => setPeriodFilter(e.target.value)}
            className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#004B2A]"
          />
        </div>
      </div>

      {/* Table Card */}
      <div className="bg-white border border-neutral-200 rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 font-medium">
              <tr>
                <th className="px-6 py-3">Employee</th>
                <th className="px-6 py-3">Period</th>
                <th className="px-6 py-3 text-right">Gross</th>
                <th className="px-6 py-3 text-right">Deductions</th>
                <th className="px-6 py-3 text-right">Net Pay</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-6 py-4">
                      <div className="h-4 bg-neutral-200 rounded w-32 mb-1"></div>
                      <div className="h-3 bg-neutral-100 rounded w-20"></div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="h-4 bg-neutral-200 rounded w-16"></div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="h-4 bg-neutral-200 rounded w-20 ml-auto"></div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="h-4 bg-neutral-200 rounded w-20 ml-auto"></div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="h-4 bg-neutral-200 rounded w-20 ml-auto"></div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="h-4 bg-neutral-200 rounded w-16"></div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="h-6 bg-neutral-200 rounded w-24 mx-auto"></div>
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-neutral-500">
                    <FileText className="w-10 h-10 text-neutral-300 mx-auto mb-2" />
                    No payslips found matching your filters.
                  </td>
                </tr>
              ) : (
                filtered.map(ps => (
                  <tr key={ps.id} className="hover:bg-neutral-50 transition">
                    <td className="px-6 py-4">
                      <div className="font-medium text-neutral-900">{ps.employeeName}</div>
                      <div className="text-xs text-neutral-500 font-mono">{ps.empCode}</div>
                    </td>
                    <td className="px-6 py-4 font-mono text-neutral-700">{ps.period}</td>
                    <td className="px-6 py-4 text-right font-medium text-neutral-900">{formatCurrency(ps.gross)}</td>
                    <td className="px-6 py-4 text-right font-medium text-red-600">{formatCurrency(ps.deductions)}</td>
                    <td className="px-6 py-4 text-right font-bold text-[#004B2A]">{formatCurrency(ps.net)}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          ps.publishedAt
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {ps.publishedAt ? 'Published' : 'Draft'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleDownload(ps.id, ps.empCode, ps.period)}
                          disabled={downloadingId === ps.id}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-[#004B2A] text-white hover:bg-[#003820] transition disabled:opacity-50"
                        >
                          <Download className="w-3.5 h-3.5" />
                          {downloadingId === ps.id ? 'Loading...' : 'PDF'}
                        </button>
                        <button
                          onClick={() => {
                            setReissuingId(ps.id);
                            setShowReissueModal(true);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-100 transition"
                        >
                          Re-issue
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reissue Modal */}
      {showReissueModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-bold text-neutral-900">Re-issue Payslip PDF</h3>
            <p className="text-xs text-neutral-500">
              This triggers a fresh pure-JS PDF generation from frozen payslip snapshot data and uploads it to MinIO. Financial calculations and payslip lines are NOT altered.
            </p>
            <div className="space-y-1">
              <label className="text-xs font-medium text-neutral-700">Audit Reason</label>
              <textarea
                value={reissueReason}
                onChange={e => setReissueReason(e.target.value)}
                placeholder="e.g. Employee requested re-generation with updated designation or address..."
                rows={3}
                className="w-full border border-neutral-300 rounded p-2 text-sm focus:ring-2 focus:ring-[#004B2A] focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setShowReissueModal(false);
                  setReissuingId(null);
                  setReissueReason('');
                }}
                className="px-4 py-2 text-sm border border-neutral-300 rounded hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                onClick={handleReissue}
                disabled={!reissueReason.trim() || reissueReason.length < 5}
                className="px-4 py-2 text-sm bg-[#004B2A] text-white rounded hover:bg-[#003820] disabled:opacity-50"
              >
                Confirm Re-issue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
