'use client';

import React, { useEffect, useState } from 'react';
import {
  Building2,
  Calendar,
  ShieldCheck,
  Scale,
  Save,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

interface PayrollSettingsData {
  payCycle: 'monthly';
  payDay: number;
  paidDaysBasis: 'calendar' | 'fixed_30' | 'working_days';
  prorationMode: 'prorate_earnings' | 'deduct_lop';
  fyStartMonth: number;
  labourCodeWages: {
    enabled: boolean;
    floorPct: number;
  };
  pfEnabled: boolean;
  esiEnabled: boolean;
  ptEnabled: boolean;
  lwfEnabled: boolean;
  negativeNetPolicy: 'block' | 'hold' | 'carry_forward';
}

interface LegalEntityData {
  id: string;
  name: string;
  pan: string;
  tan: string;
  pfEstablishmentId: string | null;
  esiCode: string | null;
}

export default function PayrollSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [entity, setEntity] = useState<LegalEntityData | null>(null);
  const [settings, setSettings] = useState<PayrollSettingsData>({
    payCycle: 'monthly',
    payDay: 30,
    paidDaysBasis: 'calendar',
    prorationMode: 'prorate_earnings',
    fyStartMonth: 4,
    labourCodeWages: { enabled: true, floorPct: 50 },
    pfEnabled: true,
    esiEnabled: true,
    ptEnabled: true,
    lwfEnabled: true,
    negativeNetPolicy: 'block',
  });

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const res = await fetch('/api/v1/payroll/settings');
        if (!res.ok) throw new Error('Failed to load payroll settings');
        const json = await res.json();
        if (json.data?.settings) {
          setSettings(prev => ({ ...prev, ...json.data.settings }));
        }
        if (json.data?.legalEntities?.length > 0) {
          setEntity(json.data.legalEntities[0]);
        }
      } catch (err: unknown) {
        setErrorMsg((err as Error).message);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setErrorMsg(null);
      setSuccessMsg(null);

      const res = await fetch('/api/v1/payroll/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.message || 'Failed to update settings');
      }

      setSuccessMsg('Payroll configuration saved successfully');
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: unknown) {
      setErrorMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-6 animate-pulse">
        <div className="h-8 bg-muted rounded w-1/4" />
        <div className="h-64 bg-card rounded-2xl border border-border" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Payroll Settings & Legal Entity
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure pay cycles, statutory compliance rules, and Indian Labour Code enforcement.
        </p>
      </div>

      {successMsg && (
        <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-xl text-sm">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/20 text-destructive rounded-xl text-sm">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-8">
        {/* Legal Entity Card */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-border">
            <Building2 className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">Primary Legal Entity</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Entity Legal Name
              </label>
              <div className="mt-1 font-medium text-foreground">
                {entity?.name || 'Primary Corporate Entity'}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Permanent Account Number (PAN)
              </label>
              <div className="mt-1 font-mono text-foreground">{entity?.pan || 'AAAAA0000A'}</div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Tax Deduction Account Number (TAN)
              </label>
              <div className="mt-1 font-mono text-foreground">{entity?.tan || 'AAAA00000A'}</div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                PF Establishment Code
              </label>
              <div className="mt-1 font-mono text-foreground">
                {entity?.pfEstablishmentId || 'MH/BAN/0012345/000'}
              </div>
            </div>
          </div>
        </div>

        {/* Pay Cycle & Days Basis */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-border">
            <Calendar className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">Pay Cycle & Days Basis</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="text-sm font-medium text-foreground block mb-2">
                Pay Cycle
              </label>
              <select
                className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={settings.payCycle}
                onChange={e =>
                  setSettings(s => ({ ...s, payCycle: e.target.value as 'monthly' }))
                }
              >
                <option value="monthly">Monthly</option>
              </select>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground block mb-2">
                Disbursement Day
              </label>
              <input
                type="number"
                min={1}
                max={31}
                className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={settings.payDay}
                onChange={e =>
                  setSettings(s => ({ ...s, payDay: parseInt(e.target.value, 10) || 30 }))
                }
              />
            </div>

            <div>
              <label className="text-sm font-medium text-foreground block mb-2">
                Paid-Days Basis
              </label>
              <select
                className="w-full h-10 px-3 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={settings.paidDaysBasis}
                onChange={e =>
                  setSettings(s => ({
                    ...s,
                    paidDaysBasis: e.target.value as 'calendar' | 'fixed_30' | 'working_days',
                  }))
                }
              >
                <option value="calendar">Calendar Days in Month (28-31)</option>
                <option value="fixed_30">Fixed 30 Days Basis</option>
                <option value="working_days">Working Days (Excl. Holidays/Weekoffs)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Labour Code & Wage Safeguards */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-border">
            <Scale className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">
              Code on Wages (50% Statutory Wage Floor)
            </h2>
          </div>

          <div className="space-y-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-primary/20"
                checked={settings.labourCodeWages.enabled}
                onChange={e =>
                  setSettings(s => ({
                    ...s,
                    labourCodeWages: { ...s.labourCodeWages, enabled: e.target.checked },
                  }))
                }
              />
              <div>
                <span className="text-sm font-medium text-foreground">
                  Enforce Code on Wages 50% Floor Verification
                </span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Warns HR and Finance when Basic and statutory components are below 50% of total
                  remuneration, and computes deemed wages during statutory contribution assessment.
                </p>
              </div>
            </label>

            {settings.labourCodeWages.enabled && (
              <div className="max-w-xs pt-2">
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  Floor Percentage (%)
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm"
                  value={settings.labourCodeWages.floorPct}
                  onChange={e =>
                    setSettings(s => ({
                      ...s,
                      labourCodeWages: {
                        ...s.labourCodeWages,
                        floorPct: parseFloat(e.target.value) || 50,
                      },
                    }))
                  }
                />
              </div>
            )}
          </div>
        </div>

        {/* Statutory Toggles */}
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-3 pb-3 border-b border-border">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">
              Active Statutory Deductions
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-muted/40 cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/20"
                checked={settings.pfEnabled}
                onChange={e => setSettings(s => ({ ...s, pfEnabled: e.target.checked }))}
              />
              <span className="text-sm font-medium text-foreground">
                Provident Fund (PF / EPF)
              </span>
            </label>

            <label className="flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-muted/40 cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/20"
                checked={settings.esiEnabled}
                onChange={e => setSettings(s => ({ ...s, esiEnabled: e.target.checked }))}
              />
              <span className="text-sm font-medium text-foreground">
                Employee State Insurance (ESI)
              </span>
            </label>

            <label className="flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-muted/40 cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/20"
                checked={settings.ptEnabled}
                onChange={e => setSettings(s => ({ ...s, ptEnabled: e.target.checked }))}
              />
              <span className="text-sm font-medium text-foreground">Professional Tax (PT)</span>
            </label>

            <label className="flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-muted/40 cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/20"
                checked={settings.lwfEnabled}
                onChange={e => setSettings(s => ({ ...s, lwfEnabled: e.target.checked }))}
              />
              <span className="text-sm font-medium text-foreground">Labour Welfare Fund (LWF)</span>
            </label>
          </div>
        </div>

        {/* Action Button */}
        <div className="flex justify-end pt-4">
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-primary text-primary-foreground font-medium text-sm rounded-xl hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </form>
    </div>
  );
}
