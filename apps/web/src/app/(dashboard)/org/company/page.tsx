'use client';

import React, { useEffect, useState } from 'react';
import {
  Building2,
  Globe,
  Clock,
  CircleDollarSign,
  Calendar,
  Save,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

interface CompanyData {
  id: string;
  name: string;
  legalName: string;
  domain: string;
  timezone: string;
  currency: string;
  fiscalYearStartMonth: number;
}

export default function CompanySettingsPage() {
  const [company, setCompany] = useState<CompanyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Form Fields
  const [name, setName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [currency, setCurrency] = useState('INR');
  const [fiscalYearStartMonth, setFiscalYearStartMonth] = useState(4);

  useEffect(() => {
    async function loadCompany() {
      try {
        setLoading(true);
        const res = await fetch('/api/v1/org/company');
        if (res.ok) {
          const data = await res.json();
          const comp = data.company;
          if (comp) {
            setCompany(comp);
            setName(comp.name);
            setLegalName(comp.legalName);
            setTimezone(comp.timezone);
            setCurrency(comp.currency);
            setFiscalYearStartMonth(comp.fiscalYearStartMonth);
          }
        }
      } finally {
        setLoading(false);
      }
    }

    loadCompany();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);

    try {
      const res = await fetch('/api/v1/org/company', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          legalName,
          timezone,
          currency,
          fiscalYearStartMonth: Number(fiscalYearStartMonth),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: 'error', message: data.error?.message || 'Failed to update company settings.' });
      } else {
        setFeedback({ type: 'success', message: 'Organization profile updated successfully.' });
        setCompany(data.company);
      }
    } catch {
      setFeedback({ type: 'error', message: 'Network communication error.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '1.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
          <Building2 size={16} color="var(--warning)" />
          <span style={{ fontSize: '0.8125rem', color: 'var(--warning)', fontWeight: 600 }}>ORGANIZATION</span>
        </div>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
          Legal Entity & Company Profile
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Configure enterprise operational parameters, statutory currency, and timezone configurations.
        </p>
      </div>

      {loading ? (
        <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
          Loading organization profile...
        </div>
      ) : (
        <div className="glass-panel" style={{ maxWidth: '720px', padding: '2rem' }}>
          {feedback && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.625rem',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                backgroundColor: feedback.type === 'success' ? 'var(--success-light)' : 'var(--danger-light)',
                color: feedback.type === 'success' ? '#6ee7b7' : '#fca5a5',
                fontSize: '0.8125rem',
                marginBottom: '1.5rem',
              }}
            >
              {feedback.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
              <span>{feedback.message}</span>
            </div>
          )}

          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
              <div>
                <label
                  htmlFor="org-name"
                  style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.375rem' }}
                >
                  Operating Brand Name
                </label>
                <input
                  id="org-name"
                  type="text"
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="form-input"
                />
              </div>

              <div>
                <label
                  htmlFor="legal-name"
                  style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.375rem' }}
                >
                  Registered Legal Name
                </label>
                <input
                  id="legal-name"
                  type="text"
                  required
                  value={legalName}
                  onChange={e => setLegalName(e.target.value)}
                  className="form-input"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="org-domain"
                style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.375rem' }}
              >
                Internal Domain (Immutable)
              </label>
              <div style={{ position: 'relative' }}>
                <Globe
                  size={16}
                  style={{
                    position: 'absolute',
                    left: '0.875rem',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-muted)',
                  }}
                />
                <input
                  id="org-domain"
                  type="text"
                  disabled
                  value={company?.domain || 'orghub.internal'}
                  className="form-input"
                  style={{ paddingLeft: '2.5rem', opacity: 0.7, cursor: 'not-allowed' }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
              <div>
                <label
                  htmlFor="org-timezone"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.375rem' }}
                >
                  <Clock size={13} />
                  <span>Timezone</span>
                </label>
                <select
                  id="org-timezone"
                  value={timezone}
                  onChange={e => setTimezone(e.target.value)}
                  className="form-input"
                >
                  <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                  <option value="UTC">UTC</option>
                  <option value="America/New_York">America/New_York (EST)</option>
                  <option value="Europe/London">Europe/London (GMT)</option>
                  <option value="Asia/Dubai">Asia/Dubai (GST)</option>
                  <option value="Asia/Singapore">Asia/Singapore (SGT)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="org-currency"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.375rem' }}
                >
                  <CircleDollarSign size={13} />
                  <span>Currency</span>
                </label>
                <select
                  id="org-currency"
                  value={currency}
                  onChange={e => setCurrency(e.target.value)}
                  className="form-input"
                >
                  <option value="INR">INR (₹)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="AED">AED (د.إ)</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="fiscal-month"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.375rem' }}
                >
                  <Calendar size={13} />
                  <span>Fiscal Start</span>
                </label>
                <select
                  id="fiscal-month"
                  value={fiscalYearStartMonth}
                  onChange={e => setFiscalYearStartMonth(Number(e.target.value))}
                  className="form-input"
                >
                  <option value={1}>January (Cal.)</option>
                  <option value={4}>April (India)</option>
                  <option value={7}>July</option>
                  <option value={10}>October</option>
                </select>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button
                type="submit"
                disabled={saving}
                className="btn-primary"
              >
                <Save size={16} />
                <span>{saving ? 'Saving Changes...' : 'Save Settings'}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
