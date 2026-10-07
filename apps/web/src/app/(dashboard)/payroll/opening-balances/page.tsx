'use client';

import React, { useState } from 'react';

export default function OpeningBalancesPage() {
  const [step, setStep] = useState<'upload' | 'preview' | 'completed'>('upload');
  const [isProcessing, setIsProcessing] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);

  const previewData = {
    totalRows: 48,
    validRows: 48,
    errorRows: 0,
    grossEarnings: '₹5,76,00,000.00',
    tdsDeducted: '₹68,40,000.00',
    pfYtd: '₹8,64,000.00',
    ptYtd: '₹96,000.00',
  };

  const handleConfirm = () => {
    setIsProcessing(true);
    setTimeout(() => {
      setJobId(crypto.randomUUID());
      setIsProcessing(false);
      setStep('completed');
    }, 500);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Opening Balances (YTD) Import Wizard
          </h1>
          <p className="text-sm text-muted-foreground">
            Cutover import for mid-year go-live: Ingest historical YTD earnings, deductions, and TDS deducted into projection engine.
          </p>
        </div>
      </div>

      {step === 'upload' && (
        <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
            📁
          </div>
          <h3 className="mt-4 text-base font-semibold text-foreground">Upload Legacy YTD Balance File (CSV / Excel)</h3>
          <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
            Must contain Employee Code, Financial Year, As of Period, Component Code, Gross Amount, and TDS Deducted so far.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => setStep('preview')}
              className="px-4 py-2 bg-emerald-700 text-white rounded-md text-sm font-medium hover:bg-emerald-800 transition"
            >
              Select CSV & Validate Preview
            </button>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="text-xs font-medium text-muted-foreground uppercase">Valid Records</div>
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                {previewData.validRows} / {previewData.totalRows}
              </div>
              <div className="text-xs text-muted-foreground mt-1">100% matched to active employees</div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="text-xs font-medium text-muted-foreground uppercase">Total YTD Gross</div>
              <div className="text-2xl font-bold text-foreground mt-1">{previewData.grossEarnings}</div>
              <div className="text-xs text-muted-foreground mt-1">Ingested into earnings ledger</div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="text-xs font-medium text-muted-foreground uppercase">Total TDS Deducted</div>
              <div className="text-2xl font-bold text-foreground mt-1">{previewData.tdsDeducted}</div>
              <div className="text-xs text-muted-foreground mt-1">Feeds Section 392 tax projections</div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="text-xs font-medium text-muted-foreground uppercase">PF & PT Accumulation</div>
              <div className="text-2xl font-bold text-foreground mt-1">{previewData.pfYtd}</div>
              <div className="text-xs text-muted-foreground mt-1">Statutory ceilings preserved</div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-6 shadow-sm flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-foreground">Confirm Import & Seed YTD Ledger</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                This operation is atomic and reversible. An audit log and snapshot job ID will be preserved.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep('upload')}
                className="px-4 py-2 border border-border rounded-md text-sm font-medium hover:bg-muted transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isProcessing}
                className="px-4 py-2 bg-emerald-700 text-white rounded-md text-sm font-medium hover:bg-emerald-800 transition"
              >
                {isProcessing ? 'Importing...' : 'Confirm & Commit Opening Balances'}
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 'completed' && (
        <div className="rounded-xl border border-border bg-card p-8 text-center shadow-sm">
          <div className="text-emerald-600 text-3xl mb-2">✓</div>
          <h2 className="text-lg font-bold text-foreground">Opening Balances Successfully Committed</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Import Job Reference: <span className="font-mono text-xs">{jobId}</span>
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => setStep('upload')}
              className="px-4 py-2 bg-secondary text-secondary-foreground text-sm font-medium rounded-md hover:bg-secondary/80 transition"
            >
              Import Another File
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
