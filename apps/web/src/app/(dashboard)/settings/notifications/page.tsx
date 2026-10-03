'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, Check, Loader2, ArrowLeft, Mail, Smartphone } from 'lucide-react';

export default function NotificationPreferencesPage() {
  const [inApp, setInApp] = useState(true);
  const [email, setEmail] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    async function loadPrefs() {
      try {
        setLoading(true);
        const res = await fetch('/api/v1/me/notification-preferences');
        if (res.ok) {
          const json = await res.json();
          const channels = json.data?.channels || {};
          setInApp(channels.in_app !== false);
          setEmail(channels.email !== false);
        }
      } finally {
        setLoading(false);
      }
    }
    loadPrefs();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedSuccess(false);

    try {
      const res = await fetch('/api/v1/me/notification-preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channels: {
            in_app: inApp,
            email,
          },
        }),
      });

      if (res.ok) {
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 2500);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </Link>
      </div>

      <div>
        <div className="flex items-center gap-2">
          <Bell className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Notification Preferences
          </h1>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Customize delivery channels for profile approvals, document statuses, and compliance notices.
        </p>
      </div>

      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span>Loading preferences...</span>
          </div>
        ) : (
          <>
            {savedSuccess && (
              <div className="p-3 text-xs rounded-xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 flex items-center gap-2">
                <Check className="h-4 w-4 shrink-0" />
                <span>Preferences saved successfully.</span>
              </div>
            )}

        <form onSubmit={handleSave} className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-start justify-between p-4 rounded-xl border border-border bg-card/60 gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
                  <Smartphone className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-foreground">In-App Notification Center</h4>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Real-time popover alerts delivered via Server-Sent Events (SSE).
                  </p>
                </div>
              </div>

              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={inApp}
                  onChange={e => setInApp(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>

            <div className="flex items-start justify-between p-4 rounded-xl border border-border bg-card/60 gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
                  <Mail className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-foreground">Email Notifications</h4>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Formatted transactional emails for critical decisions and approvals.
                  </p>
                </div>
              </div>

              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={email}
                  onChange={e => setEmail(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-sm disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save Preferences
            </button>
          </div>
        </form>
        </>
        )}
      </div>
    </div>
  );
}
