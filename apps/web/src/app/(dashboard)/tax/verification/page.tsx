'use client';

import React, { useState } from 'react';

interface VerificationRow {
  id: string;
  empCode: string;
  employeeName: string;
  deductionCode: string;
  declaredAmount: number;
  verifiedAmount: number;
  proofDocument: string;
  status: 'pending' | 'verified' | 'rejected';
}

export default function TaxVerificationPage() {
  const [rows, setRows] = useState<VerificationRow[]>([
    {
      id: 'item-1',
      empCode: 'EMP00101',
      employeeName: 'Rahul Verma',
      deductionCode: '80C - PPF Receipt',
      declaredAmount: 150000,
      verifiedAmount: 150000,
      proofDocument: 'ppf_statement_2026.pdf',
      status: 'pending',
    },
    {
      id: 'item-2',
      empCode: 'EMP00102',
      employeeName: 'Anita Desai',
      deductionCode: '80D - Health Insurance',
      declaredAmount: 35000,
      verifiedAmount: 25000,
      proofDocument: 'star_health_receipt.pdf',
      status: 'pending',
    },
    {
      id: 'item-3',
      empCode: 'EMP00103',
      employeeName: 'Vikram Rao',
      deductionCode: '24(b) - Home Loan Interest Certificate',
      declaredAmount: 180000,
      verifiedAmount: 180000,
      proofDocument: 'sbi_interest_cert.pdf',
      status: 'verified',
    },
  ]);

  const handleVerify = (id: string, verifiedAmount: number) => {
    setRows(prev =>
      prev.map(r => (r.id === id ? { ...r, verifiedAmount, status: 'verified' } : r)),
    );
  };

  const handleReject = (id: string) => {
    setRows(prev =>
      prev.map(r => (r.id === id ? { ...r, verifiedAmount: 0, status: 'rejected' } : r)),
    );
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Tax Proof Verification Inbox
          </h1>
          <p className="text-sm text-muted-foreground">
            Audit employee investment proofs, verify declared deduction values, and enforce compliance before cut-off.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-md hover:bg-emerald-800 transition"
          >
            Lock Declarations for Run
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-xs font-semibold text-muted-foreground uppercase">
                <th className="p-4">Employee</th>
                <th className="p-4">Deduction Item</th>
                <th className="p-4">Proof Attachment</th>
                <th className="p-4">Declared (₹)</th>
                <th className="p-4">Verified (₹)</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(row => (
                <tr key={row.id} className="hover:bg-muted/10 transition">
                  <td className="p-4">
                    <div className="font-medium text-foreground">{row.employeeName}</div>
                    <div className="text-xs text-muted-foreground">{row.empCode}</div>
                  </td>
                  <td className="p-4 font-medium text-foreground">{row.deductionCode}</td>
                  <td className="p-4">
                    <span className="text-xs text-primary font-medium underline cursor-pointer">
                      {row.proofDocument}
                    </span>
                  </td>
                  <td className="p-4">₹{row.declaredAmount.toLocaleString('en-IN')}</td>
                  <td className="p-4">
                    <input
                      type="number"
                      value={row.verifiedAmount}
                      disabled={row.status === 'verified'}
                      onChange={e => {
                        const val = Number(e.target.value) || 0;
                        setRows(prev =>
                          prev.map(r => (r.id === row.id ? { ...r, verifiedAmount: val } : r)),
                        );
                      }}
                      className="h-8 w-28 rounded border border-input bg-background px-2 text-sm"
                    />
                  </td>
                  <td className="p-4">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        row.status === 'verified'
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-400'
                          : row.status === 'rejected'
                          ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-400'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-400'
                      }`}
                    >
                      {row.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="p-4 text-right space-x-2">
                    {row.status === 'pending' && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleVerify(row.id, row.declaredAmount)}
                          className="px-2.5 py-1 bg-emerald-600 text-white rounded text-xs font-medium hover:bg-emerald-700 transition"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReject(row.id)}
                          className="px-2.5 py-1 bg-rose-600 text-white rounded text-xs font-medium hover:bg-rose-700 transition"
                        >
                          Reject
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
