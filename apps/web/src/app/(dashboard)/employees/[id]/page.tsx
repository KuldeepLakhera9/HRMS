'use client';

import React, { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  Briefcase,
  MapPin,
  UserCheck,
  Calendar,
  Lock,
  Unlock,
  CreditCard,
  FileText,
  Clock,
  ArrowLeft,
  CheckCircle,
  AlertCircle,
  ShieldAlert,
  Loader2,
} from 'lucide-react';

interface MaskedEmployee {
  id: string;
  empCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  emailWork: string;
  emailPersonal: string | null;
  phone: string | null;
  departmentId: string | null;
  departmentName?: string | null;
  designationId: string | null;
  designationName?: string | null;
  locationId: string | null;
  locationName?: string | null;
  managerId: string | null;
  managerName?: string | null;
  employmentType: string;
  status: string;
  doj: string;
  jobEffectiveFrom: string;
  pan: string | null;
  aadhaar: string | null;
  bankAccount: string | null;
}

interface EmployeeHistoryItem {
  id: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  effectiveFrom: string;
  appliedAt: string | null;
  reason: string | null;
  createdAt: string;
}

export default function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const employeeId = resolvedParams.id;

  const [employee, setEmployee] = useState<MaskedEmployee | null>(null);
  const [history, setHistory] = useState<EmployeeHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Unmasked sensitive info state
  const [unmaskedData, setUnmaskedData] = useState<{
    pan: string | null;
    aadhaar: string | null;
    bankAccount: string | null;
  } | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpPassword, setStepUpPassword] = useState('');
  const [stepUpError, setStepUpError] = useState<string | null>(null);
  const [elevating, setElevating] = useState(false);

  // Job Change Modal State
  const [jobModalOpen, setJobModalOpen] = useState(false);
  const [jobField, setJobField] = useState<'departmentId' | 'designationId' | 'managerId' | 'status'>('designationId');
  const [newValue, setNewValue] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [changeReason, setChangeReason] = useState('');
  const [changingJob, setChangingJob] = useState(false);
  const [jobChangeError, setJobChangeError] = useState<string | null>(null);

  const loadEmployeeData = async () => {
    try {
      setLoading(true);
      const [empRes, histRes] = await Promise.all([
        fetch(`/api/v1/employees/${employeeId}`),
        fetch(`/api/v1/employees/${employeeId}/history`),
      ]);

      if (empRes.ok) {
        const json = await empRes.json();
        setEmployee(json.data);
      }
      if (histRes.ok) {
        const json = await histRes.json();
        setHistory(json.data || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEmployeeData();
  }, [employeeId]);

  const handleStepUpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setElevating(true);
    setStepUpError(null);

    try {
      // 1. Elevate session step-up
      const stepUpRes = await fetch('/api/v1/auth/step-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: stepUpPassword }),
      });

      if (!stepUpRes.ok) {
        const err = await stepUpRes.json();
        throw new Error(err.error?.message || err.message || 'Authentication failed.');
      }

      // 2. Fetch sensitive unmasked fields
      const sensRes = await fetch(`/api/v1/employees/${employeeId}/sensitive`);
      if (!sensRes.ok) {
        const err = await sensRes.json();
        throw new Error(err.error?.message || 'Failed to fetch sensitive details.');
      }

      const sensJson = await sensRes.json();
      setUnmaskedData(sensJson.data);
      setStepUpOpen(false);
      setStepUpPassword('');
    } catch (err: unknown) {
      setStepUpError((err as Error).message || 'Step-up authentication failed.');
    } finally {
      setElevating(false);
    }
  };

  const handleJobChangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangingJob(true);
    setJobChangeError(null);

    try {
      const res = await fetch(`/api/v1/employees/${employeeId}/job-change`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: jobField,
          newValue: newValue.trim() || null,
          effectiveFrom,
          reason: changeReason || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || err.message || 'Failed to apply job change.');
      }

      setJobModalOpen(false);
      setNewValue('');
      setChangeReason('');
      await loadEmployeeData();
    } catch (err: unknown) {
      setJobChangeError((err as Error).message || 'Failed to apply job change.');
    } finally {
      setChangingJob(false);
    }
  };

  if (loading) {
    return (
      <div className="p-12 text-center text-muted-foreground flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="text-sm">Loading employee profile...</span>
      </div>
    );
  }

  if (!employee) {
    return (
      <div className="p-8 max-w-4xl mx-auto text-center space-y-4">
        <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
        <h2 className="text-xl font-bold">Employee Not Found</h2>
        <Link href="/employees" className="text-sm text-primary hover:underline">
          Return to directory
        </Link>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      {/* Back button */}
      <div>
        <Link
          href="/employees"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Employee Directory
        </Link>
      </div>

      {/* Profile Header Card */}
      <div className="bg-card border border-border rounded-2xl p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center font-bold text-primary text-xl shadow-inner">
            {employee.firstName.charAt(0)}
            {employee.lastName.charAt(0)}
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {employee.fullName}
              </h1>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 capitalize">
                <CheckCircle className="h-3 w-3" />
                {employee.status}
              </span>
            </div>
            <div className="text-sm text-muted-foreground font-mono mt-1">
              {employee.empCode} • {employee.emailWork}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setJobModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-sm"
          >
            <Clock className="h-4 w-4" /> Change Job Assignment
          </button>
        </div>
      </div>

      {/* 2-Column Layout */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Column: Organization & Work Details */}
        <div className="md:col-span-2 space-y-6">
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-primary" />
              Work & Hierarchy Assignment
            </h2>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="p-3 rounded-xl bg-muted/20 border border-border">
                <span className="text-xs text-muted-foreground block mb-0.5">Designation</span>
                <span className="font-semibold text-foreground">{employee.designationName || 'Not Assigned'}</span>
              </div>
              <div className="p-3 rounded-xl bg-muted/20 border border-border">
                <span className="text-xs text-muted-foreground block mb-0.5">Department</span>
                <span className="font-semibold text-foreground">{employee.departmentName || 'Not Assigned'}</span>
              </div>
              <div className="p-3 rounded-xl bg-muted/20 border border-border">
                <span className="text-xs text-muted-foreground block mb-0.5">Direct Manager</span>
                <span className="font-semibold text-foreground flex items-center gap-1">
                  <UserCheck className="h-3.5 w-3.5 text-primary" />
                  {employee.managerName || 'None (Top Level)'}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-muted/20 border border-border">
                <span className="text-xs text-muted-foreground block mb-0.5">Work Location</span>
                <span className="font-semibold text-foreground flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 text-primary" />
                  {employee.locationName || 'Remote / HQ'}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-muted/20 border border-border">
                <span className="text-xs text-muted-foreground block mb-0.5">Date of Joining</span>
                <span className="font-semibold text-foreground flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  {employee.doj}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-muted/20 border border-border">
                <span className="text-xs text-muted-foreground block mb-0.5">Employment Type</span>
                <span className="font-semibold text-foreground capitalize">
                  {employee.employmentType.replace('_', ' ')}
                </span>
              </div>
            </div>
          </div>

          {/* Effective-Dated Timeline */}
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Effective-Dated Change Timeline
            </h2>

            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No historical changes recorded.</p>
            ) : (
              <div className="divide-y divide-border">
                {history.map(item => (
                  <div key={item.id} className="py-3 flex items-start justify-between text-xs">
                    <div>
                      <div className="font-semibold text-foreground capitalize">
                        {item.field.replace(/([A-Z])/g, ' $1')} Change
                      </div>
                      <div className="text-muted-foreground mt-0.5">
                        New Value: <span className="font-mono text-foreground font-medium">{String(item.newValue)}</span>
                      </div>
                      {item.reason && (
                        <div className="text-[11px] text-muted-foreground italic mt-0.5">
                          Reason: {item.reason}
                        </div>
                      )}
                    </div>
                    <div className="text-right space-y-1">
                      <div className="font-mono text-muted-foreground">
                        Effective: {item.effectiveFrom}
                      </div>
                      {item.appliedAt ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                          Applied
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-full">
                          Scheduled Future
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Encrypted Sensitive Identity Card */}
        <div className="space-y-6">
          <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Lock className="h-4 w-4 text-primary" />
                Identity & Bank Info
              </h2>
              {unmaskedData ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                  <Unlock className="h-3 w-3" /> Unmasked
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                  <Lock className="h-3 w-3" /> Masked
                </span>
              )}
            </div>

            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-muted/20 border border-border space-y-1">
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-primary" />
                  PAN Card Number
                </span>
                <div className="text-sm font-mono font-bold text-foreground">
                  {unmaskedData ? unmaskedData.pan || 'N/A' : employee.pan || 'N/A'}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-muted/20 border border-border space-y-1">
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-primary" />
                  Aadhaar Number
                </span>
                <div className="text-sm font-mono font-bold text-foreground">
                  {unmaskedData ? unmaskedData.aadhaar || 'N/A' : employee.aadhaar || 'N/A'}
                </div>
              </div>

              <div className="p-3 rounded-xl bg-muted/20 border border-border space-y-1">
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <CreditCard className="h-3.5 w-3.5 text-primary" />
                  Bank Account
                </span>
                <div className="text-sm font-mono font-bold text-foreground">
                  {unmaskedData ? unmaskedData.bankAccount || 'N/A' : employee.bankAccount || 'N/A'}
                </div>
              </div>
            </div>

            {!unmaskedData && (
              <button
                onClick={() => setStepUpOpen(true)}
                className="w-full mt-2 inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border border-border bg-background hover:bg-muted text-foreground transition"
              >
                <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
                Unlock Sensitive Details
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Step-Up Authentication Elevation Modal */}
      {stepUpOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
            <div className="text-center space-y-2">
              <ShieldAlert className="h-10 w-10 text-amber-500 mx-auto" />
              <h3 className="text-base font-bold text-foreground">Elevated Security Required</h3>
              <p className="text-xs text-muted-foreground">
                To decrypt and view unmasked identity data, please verify your credentials.
              </p>
            </div>

            {stepUpError && (
              <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-xs">
                {stepUpError}
              </div>
            )}

            <form onSubmit={handleStepUpSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Account Password *
                </label>
                <input
                  type="password"
                  required
                  placeholder="Enter your current password"
                  value={stepUpPassword}
                  onChange={e => setStepUpPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStepUpOpen(false)}
                  className="w-1/2 py-2 text-xs font-semibold rounded-lg border border-border hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={elevating}
                  className="w-1/2 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {elevating ? 'Verifying...' : 'Unlock Data'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Job Change Modal */}
      {jobModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-xl p-6 space-y-4">
            <h3 className="text-base font-bold text-foreground">Change Job Assignment</h3>

            {jobChangeError && (
              <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-xs">
                {jobChangeError}
              </div>
            )}

            <form onSubmit={handleJobChangeSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">Field to Update *</label>
                <select
                  value={jobField}
                  onChange={e => setJobField(e.target.value as 'departmentId' | 'designationId' | 'managerId' | 'status')}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                >
                  <option value="designationId">Designation ID</option>
                  <option value="departmentId">Department ID</option>
                  <option value="managerId">Direct Manager ID</option>
                  <option value="status">Employment Status</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  New Value (UUID or Status) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. valid UUID or status (active, probation)"
                  value={newValue}
                  onChange={e => setNewValue(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none font-mono text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">Effective Date *</label>
                <input
                  type="date"
                  required
                  value={effectiveFrom}
                  onChange={e => setEffectiveFrom(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                />
                <span className="text-[11px] text-muted-foreground mt-0.5 block">
                  Dates in future will be scheduled for daily worker execution.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">Reason / Notes</label>
                <input
                  type="text"
                  placeholder="e.g. Annual Promotion or Department Transfer"
                  value={changeReason}
                  onChange={e => setChangeReason(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setJobModalOpen(false)}
                  className="w-1/2 py-2 text-xs font-semibold rounded-lg border border-border hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={changingJob}
                  className="w-1/2 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {changingJob ? 'Applying...' : 'Apply Job Change'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
