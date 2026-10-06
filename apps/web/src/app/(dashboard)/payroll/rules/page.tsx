'use client';

import React, { useEffect, useState } from 'react';
import {
  Scale,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileCheck2,
  MapPin,
} from 'lucide-react';

interface StatutoryRuleItem {
  id: string;
  key: string;
  version: number;
  jurisdiction: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: 'draft' | 'pending_approval' | 'active' | 'retired';
  caVerifiedBy: string | null;
  caVerifiedOn: string | null;
  sourceNote: string | null;
  makerId: string;
  checkerId: string | null;
}

export default function StatutoryRulesPage() {
  const [rules, setRules] = useState<StatutoryRuleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    async function loadRules() {
      try {
        setLoading(true);
        // Load rules
        const res = await fetch('/api/v1/payroll/rules');
        if (!res.ok) throw new Error('Failed to fetch statutory rule sets');
        const json = await res.json();
        setRules(json.data || []);
      } catch (err: unknown) {
        setErrorMsg((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    loadRules();
  }, []);

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Statutory Compliance Rules & Version Timeline
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Auditable chronological record of statutory rule sets (PF, ESI, PT, LWF, Gratuity, Bonus)
          verified by Chartered Accountants.
        </p>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/20 text-destructive rounded-xl text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Rules Timeline / Table */}
      <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">Rule Sets Timeline</h2>
          </div>
          <span className="text-xs text-muted-foreground">
            Zero Hardcoded Rates • Dynamic Schema Driven
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider border-b border-border">
              <tr>
                <th className="px-6 py-3 font-medium">Rule Key</th>
                <th className="px-6 py-3 font-medium">Jurisdiction</th>
                <th className="px-6 py-3 font-medium">Version</th>
                <th className="px-6 py-3 font-medium">Effective Period</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium">CA Verification</th>
                <th className="px-6 py-3 font-medium">Source Notification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-muted-foreground animate-pulse">
                    Loading statutory rule sets...
                  </td>
                </tr>
              ) : rules.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">
                    No statutory rule sets configured. Seeded CA placeholders will appear here once
                    initialized.
                  </td>
                </tr>
              ) : (
                rules.map(rule => (
                  <tr key={rule.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-6 py-4 font-mono font-medium text-foreground">{rule.key}</td>
                    <td className="px-6 py-4">
                      <span className="inline-flex items-center gap-1 font-mono text-xs px-2 py-0.5 rounded bg-muted text-foreground">
                        <MapPin className="w-3 h-3 text-muted-foreground" />
                        {rule.jurisdiction}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-muted-foreground">
                      v{rule.version}
                    </td>
                    <td className="px-6 py-4 text-xs font-mono text-muted-foreground">
                      {rule.effectiveFrom} → {rule.effectiveTo || 'Present'}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${
                          rule.status === 'active'
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                            : rule.status === 'pending_approval'
                              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                              : 'bg-muted text-muted-foreground border border-border'
                        }`}
                      >
                        {rule.status === 'active' ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : (
                          <Clock className="w-3.5 h-3.5" />
                        )}
                        <span className="capitalize">{rule.status.replace('_', ' ')}</span>
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {rule.caVerifiedBy ? (
                        <div className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                          <FileCheck2 className="w-4 h-4" />
                          <span>{rule.caVerifiedBy}</span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Pending CA Review</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-xs text-muted-foreground max-w-xs truncate">
                      {rule.sourceNote || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
