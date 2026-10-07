'use client';

import React, { useState } from 'react';

export default function StatutoryFilingsPage() {
  const [selectedRun, setSelectedRun] = useState('March 2026 Regular Run');
  const [generating, setGenerating] = useState<string | null>(null);
  const [generatedSuccess, setGeneratedSuccess] = useState<string | null>(null);

  const complianceCalendar = [
    { name: 'Provident Fund (PF) ECR & Payment', dueDay: 15, date: '15 April 2026', status: 'upcoming', penalty: 'Damages u/s 14B & interest u/s 7Q' },
    { name: 'ESIC Monthly Return & Deposit', dueDay: 15, date: '15 April 2026', status: 'upcoming', penalty: 'Interest @ 12% p.a. for delay' },
    { name: 'TDS Deposit (Section 392)', dueDay: 7, date: '07 April 2026', status: 'upcoming', penalty: 'Interest @ 1.5% per month u/s 201(1A)' },
    { name: 'Quarterly TDS Return (Form 138 / 24Q)', dueDay: 31, date: '31 May 2026', status: 'scheduled', penalty: 'Late fee ₹200/day u/s 234E' },
    { name: 'Professional Tax (PT) - Karnataka', dueDay: 20, date: '20 April 2026', status: 'upcoming', penalty: 'Penalty under State PT Act' },
  ];

  const handleGenerate = (type: string) => {
    setGenerating(type);
    setGeneratedSuccess(null);
    setTimeout(() => {
      setGenerating(null);
      setGeneratedSuccess(`Successfully generated and reconciled ${type} against payslip lines.`);
    }, 400);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Statutory Outputs & Compliance Filings
          </h1>
          <p className="text-sm text-muted-foreground">
            Generate EPFO ECR 2.0 files, ESIC monthly reports, PT summaries, and Form 138/Form 16 quarterly return data.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedRun}
            onChange={e => setSelectedRun(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
          >
            <option>March 2026 Regular Run</option>
            <option>February 2026 Regular Run</option>
          </select>
        </div>
      </div>

      {generatedSuccess && (
        <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-sm text-emerald-800 dark:text-emerald-300">
          ✓ {generatedSuccess}
        </div>
      )}

      {/* Statutory Generation Actions */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase text-emerald-600 dark:text-emerald-400">EPFO ECR 2.0</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-800">
                #~# Delimited
              </span>
            </div>
            <h3 className="font-semibold text-foreground">PF Electronic Challan Return</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Section 38(1) 11-column format. EPF 12%, EPS 8.33%, EDLI, and NCP days.
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleGenerate('PF ECR 2.0 text file')}
            disabled={generating !== null}
            className="mt-4 w-full py-2 bg-emerald-700 text-white rounded-md text-xs font-medium hover:bg-emerald-800 transition"
          >
            {generating === 'PF ECR 2.0 text file' ? 'Generating...' : 'Generate PF ECR File'}
          </button>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase text-blue-600 dark:text-blue-400">ESIC Return</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-800">
                Portal Format
              </span>
            </div>
            <h3 className="font-semibold text-foreground">ESI Contribution Data</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Employee 0.75% and employer 3.25% shares mapped to IP numbers and working days.
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleGenerate('ESI Contribution data')}
            disabled={generating !== null}
            className="mt-4 w-full py-2 bg-primary text-primary-foreground rounded-md text-xs font-medium hover:bg-primary/90 transition"
          >
            {generating === 'ESI Contribution data' ? 'Generating...' : 'Generate ESI File'}
          </button>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase text-purple-600 dark:text-purple-400">State PT</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-800">
                Multi-State
              </span>
            </div>
            <h3 className="font-semibold text-foreground">Professional Tax Summary</h3>
            <p className="text-xs text-muted-foreground mt-1">
              State-wise employee counts, slab distributions, and challan totals.
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleGenerate('Professional Tax Summary')}
            disabled={generating !== null}
            className="mt-4 w-full py-2 bg-purple-700 text-white rounded-md text-xs font-medium hover:bg-purple-800 transition"
          >
            {generating === 'Professional Tax Summary' ? 'Generating...' : 'Generate PT Summary'}
          </button>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase text-amber-600 dark:text-amber-400">Income Tax</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800">
                Form 138 / 24Q
              </span>
            </div>
            <h3 className="font-semibold text-foreground">Quarterly Salary TDS Data</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Section 392 deductions, employee PAN mapping, and challan reconciliations.
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleGenerate('Quarterly TDS Return data')}
            disabled={generating !== null}
            className="mt-4 w-full py-2 bg-amber-700 text-white rounded-md text-xs font-medium hover:bg-amber-800 transition"
          >
            {generating === 'Quarterly TDS Return data' ? 'Generating...' : 'Generate TDS Return Data'}
          </button>
        </div>
      </div>

      {/* Compliance Due-Date Calendar */}
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-foreground mb-4">Statutory Compliance Calendar & Reminders</h2>
        <div className="divide-y divide-border">
          {complianceCalendar.map((item) => (
            <div key={item.name} className="py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <div className="font-medium text-foreground">{item.name}</div>
                <div className="text-xs text-rose-600 dark:text-rose-400 mt-0.5">Non-compliance: {item.penalty}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-foreground">{item.date}</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-400">
                  Due in {item.dueDay} Days
                </span>
                <button
                  type="button"
                  className="px-3 py-1 bg-secondary text-secondary-foreground text-xs font-medium rounded hover:bg-secondary/80 transition"
                >
                  Link Challan
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
