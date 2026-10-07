'use client';

import React, { useEffect, useState } from 'react';
import {
  Receipt,
  Plus,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertCircle,
  Eye,
} from 'lucide-react';

interface ExpenseItemSummary {
  id: string;
  claimId: string;
  expenseDate: string;
  categoryId: string;
  amount: string;
  merchant: string | null;
  description: string | null;
  billHash: string | null;
  policyFlags: string[];
  approvedAmount: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectionReason: string | null;
}

interface ExpenseClaimSummary {
  id: string;
  employeeId: string;
  claimNo: string;
  title: string;
  status: 'draft' | 'submitted' | 'approved' | 'partially_approved' | 'rejected' | 'paid' | 'cancelled';
  totalClaimed: string;
  totalApproved: string;
  payoutMode: 'payroll' | 'bank';
  payoutRef: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  employeeName?: string;
  empCode?: string;
  items?: ExpenseItemSummary[];
}

interface CategoryOption {
  id: string;
  code: string;
  name: string;
}

export default function ExpensesPage() {
  const [claims, setClaims] = useState<ExpenseClaimSummary[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // New Claim Modal state
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPayoutMode, setNewPayoutMode] = useState<'payroll' | 'bank'>('payroll');
  const [newItems, setNewItems] = useState([
    {
      expenseDate: new Date().toISOString().slice(0, 10),
      categoryId: '',
      amount: '',
      merchant: '',
      description: '',
      billHash: '',
    },
  ]);
  const [submittingClaim, setSubmittingClaim] = useState(false);

  // Claim Detail Modal
  const [selectedClaim, setSelectedClaim] = useState<ExpenseClaimSummary | null>(null);
  const [_loadingDetail, setLoadingDetail] = useState(false);

  const fetchClaims = async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      let url = '/api/v1/expenses/claims?limit=50';
      if (statusFilter !== 'all') url += `&status=${statusFilter}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load expense claims');
      const data = await res.json();
      setClaims(data.data || []);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error fetching claims');
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await fetch('/api/v1/expenses/categories');
      if (res.ok) {
        const data = await res.json();
        setCategories(data.data || []);
        if (data.data?.length > 0) {
          setNewItems(prev => prev.map(i => ({ ...i, categoryId: i.categoryId || data.data[0].id })));
        }
      }
    } catch {
      // Ignored
    }
  };

  useEffect(() => {
    fetchClaims();
    fetchCategories();
  }, [statusFilter]);

  const handleOpenDetail = async (claimId: string) => {
    try {
      setLoadingDetail(true);
      const res = await fetch(`/api/v1/expenses/claims/${claimId}`);
      if (!res.ok) throw new Error('Failed to load claim details');
      const data = await res.json();
      setSelectedClaim(data.data);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load details');
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleCreateClaim = async () => {
    if (!newTitle.trim() || newItems.length === 0) return;
    try {
      setSubmittingClaim(true);
      setErrorMsg(null);
      const payload = {
        title: newTitle.trim(),
        payoutMode: newPayoutMode,
        items: newItems.map(it => ({
          expenseDate: it.expenseDate,
          categoryId: it.categoryId || (categories[0]?.id ?? ''),
          amount: Number(it.amount),
          merchant: it.merchant.trim() || undefined,
          description: it.description.trim() || undefined,
          billHash: it.billHash.trim() || undefined,
        })),
      };

      const res = await fetch('/api/v1/expenses/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to create claim');
      }

      setSuccessMsg('Expense claim created successfully.');
      setShowNewModal(false);
      setNewTitle('');
      fetchClaims();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Error creating claim');
    } finally {
      setSubmittingClaim(false);
    }
  };

  const handleSubmitForApproval = async (claimId: string) => {
    try {
      const res = await fetch(`/api/v1/expenses/claims/${claimId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: claimId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Submit failed');
      }
      setSuccessMsg('Expense claim submitted for approval.');
      fetchClaims();
      if (selectedClaim?.id === claimId) {
        handleOpenDetail(claimId);
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to submit claim');
    }
  };

  const formatCurrency = (val: string | number) => {
    const num = Number(val);
    if (isNaN(num)) return '₹0.00';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
    }).format(num);
  };

  const filtered = claims.filter(c => {
    const q = search.toLowerCase();
    return (
      c.title.toLowerCase().includes(q) ||
      c.claimNo.toLowerCase().includes(q) ||
      (c.employeeName && c.employeeName.toLowerCase().includes(q))
    );
  });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Expense Claims & Reimbursements</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Track claims, automated duplicate bill detection, multi-item approval, and payroll reimbursement payout.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchClaims()}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium border border-neutral-300 rounded-md bg-white hover:bg-neutral-50 text-neutral-700 transition"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          <button
            onClick={() => setShowNewModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md bg-[#004B2A] text-white hover:bg-[#003820] transition shadow-sm"
          >
            <Plus className="w-4 h-4" />
            New Claim
          </button>
        </div>
      </div>

      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-md text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            {successMsg}
          </span>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-700 hover:text-emerald-900 text-xs">
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
            placeholder="Search by claim no, title, employee..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-neutral-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#004B2A]"
          />
        </div>
        <div className="sm:w-48">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="w-full px-3 py-2 border border-neutral-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-[#004B2A]"
          >
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="partially_approved">Partially Approved</option>
            <option value="rejected">Rejected</option>
            <option value="paid">Paid</option>
          </select>
        </div>
      </div>

      {/* Table Card */}
      <div className="bg-white border border-neutral-200 rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 font-medium">
              <tr>
                <th className="px-6 py-3">Claim Info</th>
                <th className="px-6 py-3">Employee</th>
                <th className="px-6 py-3 text-right">Claimed</th>
                <th className="px-6 py-3 text-right">Approved</th>
                <th className="px-6 py-3">Payout Mode</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-6 py-4">
                      <div className="h-4 bg-neutral-200 rounded w-28 mb-1"></div>
                      <div className="h-3 bg-neutral-100 rounded w-36"></div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="h-4 bg-neutral-200 rounded w-24"></div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="h-4 bg-neutral-200 rounded w-16 ml-auto"></div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="h-4 bg-neutral-200 rounded w-16 ml-auto"></div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="h-4 bg-neutral-200 rounded w-16"></div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="h-4 bg-neutral-200 rounded w-20"></div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="h-6 bg-neutral-200 rounded w-20 mx-auto"></div>
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-neutral-500">
                    <Receipt className="w-10 h-10 text-neutral-300 mx-auto mb-2" />
                    No expense claims found matching your filter.
                  </td>
                </tr>
              ) : (
                filtered.map(claim => (
                  <tr key={claim.id} className="hover:bg-neutral-50 transition">
                    <td className="px-6 py-4">
                      <div className="font-medium text-neutral-900">{claim.title}</div>
                      <div className="text-xs text-neutral-500 font-mono">{claim.claimNo}</div>
                    </td>
                    <td className="px-6 py-4 text-neutral-800">
                      <div>{claim.employeeName || 'Self'}</div>
                      {claim.empCode && <div className="text-xs text-neutral-400 font-mono">{claim.empCode}</div>}
                    </td>
                    <td className="px-6 py-4 text-right font-medium text-neutral-900">
                      {formatCurrency(claim.totalClaimed)}
                    </td>
                    <td className="px-6 py-4 text-right font-bold text-[#004B2A]">
                      {formatCurrency(claim.totalApproved)}
                    </td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono uppercase bg-neutral-100 text-neutral-700">
                        {claim.payoutMode}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${
                          claim.status === 'paid'
                            ? 'bg-emerald-100 text-emerald-800'
                            : claim.status === 'approved'
                            ? 'bg-blue-100 text-blue-800'
                            : claim.status === 'submitted'
                            ? 'bg-amber-100 text-amber-800'
                            : claim.status === 'rejected'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-neutral-100 text-neutral-800'
                        }`}
                      >
                        {claim.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => handleOpenDetail(claim.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded border border-neutral-300 text-neutral-700 hover:bg-neutral-100 transition"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          View
                        </button>
                        {claim.status === 'draft' && (
                          <button
                            onClick={() => handleSubmitForApproval(claim.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-[#004B2A] text-white hover:bg-[#003820] transition"
                          >
                            Submit
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Claim Modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-bold text-neutral-900">Create Expense Claim</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-neutral-700">Claim Title</label>
                <input
                  type="text"
                  placeholder="e.g. Client Dinner & Regional Travel Q1"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  className="w-full mt-1 border border-neutral-300 rounded p-2 text-sm focus:ring-2 focus:ring-[#004B2A] focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-neutral-700">Payout Mode</label>
                <select
                  value={newPayoutMode}
                  onChange={e => setNewPayoutMode(e.target.value as 'payroll' | 'bank')}
                  className="w-full mt-1 border border-neutral-300 rounded p-2 text-sm focus:ring-2 focus:ring-[#004B2A] focus:outline-none"
                >
                  <option value="payroll">Payroll (Credited with Monthly Salary)</option>
                  <option value="bank">Direct Bank Reimbursement File</option>
                </select>
              </div>

              {/* Items Section */}
              <div className="pt-2 border-t border-neutral-200">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-neutral-800">Expense Items</h4>
                  <button
                    type="button"
                    onClick={() =>
                      setNewItems(prev => [
                        ...prev,
                        {
                          expenseDate: new Date().toISOString().slice(0, 10),
                          categoryId: categories[0]?.id ?? '',
                          amount: '',
                          merchant: '',
                          description: '',
                          billHash: '',
                        },
                      ])
                    }
                    className="text-xs text-[#004B2A] font-semibold hover:underline"
                  >
                    + Add Item
                  </button>
                </div>

                {newItems.map((item, idx) => (
                  <div key={idx} className="p-3 bg-neutral-50 rounded border border-neutral-200 space-y-2 mb-2">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <label className="text-[10px] text-neutral-500 uppercase">Date</label>
                        <input
                          type="date"
                          value={item.expenseDate}
                          onChange={e => {
                            const val = e.target.value;
                            setNewItems(prev => prev.map((it, i) => (i === idx ? { ...it, expenseDate: val } : it)));
                          }}
                          className="w-full border border-neutral-300 rounded p-1.5 text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-neutral-500 uppercase">Category</label>
                        <select
                          value={item.categoryId}
                          onChange={e => {
                            const val = e.target.value;
                            setNewItems(prev => prev.map((it, i) => (i === idx ? { ...it, categoryId: val } : it)));
                          }}
                          className="w-full border border-neutral-300 rounded p-1.5 text-xs"
                        >
                          {categories.map(cat => (
                            <option key={cat.id} value={cat.id}>
                              {cat.name} ({cat.code})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-neutral-500 uppercase">Amount (₹)</label>
                        <input
                          type="number"
                          placeholder="0.00"
                          value={item.amount}
                          onChange={e => {
                            const val = e.target.value;
                            setNewItems(prev => prev.map((it, i) => (i === idx ? { ...it, amount: val } : it)));
                          }}
                          className="w-full border border-neutral-300 rounded p-1.5 text-xs"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Merchant / Vendor (optional)"
                        value={item.merchant}
                        onChange={e => {
                          const val = e.target.value;
                          setNewItems(prev => prev.map((it, i) => (i === idx ? { ...it, merchant: val } : it)));
                        }}
                        className="w-full border border-neutral-300 rounded p-1.5 text-xs"
                      />
                      <input
                        type="text"
                        placeholder="Bill SHA-256 Hash (optional for duplicate test)"
                        value={item.billHash}
                        onChange={e => {
                          const val = e.target.value;
                          setNewItems(prev => prev.map((it, i) => (i === idx ? { ...it, billHash: val } : it)));
                        }}
                        className="w-full border border-neutral-300 rounded p-1.5 text-xs font-mono"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-neutral-200">
              <button
                type="button"
                onClick={() => setShowNewModal(false)}
                className="px-4 py-2 text-sm border border-neutral-300 rounded hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateClaim}
                disabled={submittingClaim || !newTitle.trim()}
                className="px-4 py-2 text-sm bg-[#004B2A] text-white rounded hover:bg-[#003820] disabled:opacity-50"
              >
                {submittingClaim ? 'Saving...' : 'Create Draft Claim'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Claim Detail Drawer */}
      {selectedClaim && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-lg font-bold text-neutral-900">{selectedClaim.title}</h3>
                <p className="text-xs text-neutral-500 font-mono">{selectedClaim.claimNo}</p>
              </div>
              <button onClick={() => setSelectedClaim(null)} className="text-neutral-400 hover:text-neutral-600 text-lg">
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-3 bg-neutral-50 rounded-lg text-xs">
              <div>
                <div className="text-neutral-500">Status</div>
                <div className="font-semibold capitalize text-neutral-900">{selectedClaim.status}</div>
              </div>
              <div>
                <div className="text-neutral-500">Total Claimed</div>
                <div className="font-semibold text-neutral-900">{formatCurrency(selectedClaim.totalClaimed)}</div>
              </div>
              <div>
                <div className="text-neutral-500">Total Approved</div>
                <div className="font-bold text-[#004B2A]">{formatCurrency(selectedClaim.totalApproved)}</div>
              </div>
              <div>
                <div className="text-neutral-500">Payout Mode</div>
                <div className="font-semibold uppercase text-neutral-900">{selectedClaim.payoutMode}</div>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-neutral-900 mb-2">Item Breakdown</h4>
              <div className="space-y-2">
                {selectedClaim.items && selectedClaim.items.length > 0 ? (
                  selectedClaim.items.map(item => (
                    <div key={item.id} className="p-3 border rounded-md text-xs space-y-1 bg-white">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-neutral-800">
                          {item.merchant || 'General Expense'} • {item.expenseDate}
                        </span>
                        <span className="font-bold text-neutral-900">{formatCurrency(item.amount)}</span>
                      </div>
                      {item.policyFlags && item.policyFlags.length > 0 && (
                        <div className="flex items-center gap-1 mt-1">
                          {item.policyFlags.map((flag, fi) => (
                            <span
                              key={fi}
                              className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800"
                            >
                              ⚠️ {flag.replace('_', ' ')}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="text-neutral-500 text-[11px] flex items-center justify-between pt-1">
                        <span>Status: <strong className="capitalize">{item.status}</strong></span>
                        {item.approvedAmount && (
                          <span className="text-[#004B2A]">Approved: {formatCurrency(item.approvedAmount)}</span>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-neutral-500">No items registered for this claim.</p>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <button
                onClick={() => setSelectedClaim(null)}
                className="px-4 py-2 text-sm border border-neutral-300 rounded hover:bg-neutral-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
