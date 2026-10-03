'use client';

import React, { useEffect, useState, use, useCallback } from 'react';
import Link from 'next/link';
import {
  Briefcase,
  Lock,
  Unlock,
  FileText,
  Clock,
  ArrowLeft,
  CheckCircle,
  AlertCircle,
  ShieldAlert,
  Loader2,
  Upload,
  User,
  Activity,
  Check,
  X,
  FileCheck,
  Send,
} from 'lucide-react';
import { FormField, Input, Select, Textarea } from '../../../../components/ui/FormKit.js';
import { EmptyState, TableLoadingSkeleton } from '../../../../components/ui/States.js';

interface MaskedEmployee {
  id: string;
  empCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  emailWork: string;
  emailPersonal: string | null;
  phone: string | null;
  addresses?: Record<string, unknown>;
  emergencyContacts?: Array<Record<string, unknown>>;
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
  customFields?: Record<string, unknown>;
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

interface DocumentItem {
  id: string;
  type: string;
  fileId: string;
  status: 'pending' | 'verified' | 'rejected';
  expiry: string | null;
  verifiedBy: string | null;
  verificationComment: string | null;
  originalName?: string;
  mime?: string;
  sizeBytes?: number;
  createdAt: string;
}

interface AuditLogItem {
  id: string;
  ts: string;
  action: string;
  actorRole: string | null;
  ip: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export default function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const employeeId = resolvedParams.id;

  const [employee, setEmployee] = useState<MaskedEmployee | null>(null);
  const [history, setHistory] = useState<EmployeeHistoryItem[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [activityLogs, setActivityLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Active tab state
  const [activeTab, setActiveTab] = useState<
    'overview' | 'job_history' | 'documents' | 'personal' | 'sensitive' | 'activity'
  >('overview');

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
  const [jobField, setJobField] = useState<
    'departmentId' | 'designationId' | 'managerId' | 'status'
  >('designationId');
  const [newValue, setNewValue] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [changeReason, setChangeReason] = useState('');
  const [changingJob, setChangingJob] = useState(false);
  const [jobChangeError, setJobChangeError] = useState<string | null>(null);

  // Document Upload Modal State
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [docType, setDocType] = useState('Identity Proof');
  const [docExpiry, setDocExpiry] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [docUploadError, setDocUploadError] = useState<string | null>(null);

  // Document Verify Modal State
  const [verifyDocId, setVerifyDocId] = useState<string | null>(null);
  const [verifyDecision, setVerifyDecision] = useState<'verified' | 'rejected'>('verified');
  const [verifyComment, setVerifyComment] = useState('');
  const [verifying, setVerifying] = useState(false);

  // Profile Change Request Modal State
  const [changeRequestOpen, setChangeRequestOpen] = useState(false);
  const [reqPhone, setReqPhone] = useState('');
  const [reqPersonalEmail, setReqPersonalEmail] = useState('');
  const [reqMaritalStatus, setReqMaritalStatus] = useState('single');
  const [submittingReq, setSubmittingReq] = useState(false);
  const [reqSuccess, setReqSuccess] = useState(false);
  const [reqError, setReqError] = useState<string | null>(null);

  const loadEmployeeData = useCallback(async () => {
    try {
      setLoading(true);
      const [empRes, histRes, docsRes, actRes] = await Promise.all([
        fetch(`/api/v1/employees/${employeeId}`),
        fetch(`/api/v1/employees/${employeeId}/history`),
        fetch(`/api/v1/employees/${employeeId}/documents`),
        fetch(`/api/v1/audit-logs?entity=employee&entityId=${employeeId}&limit=20`),
      ]);

      if (empRes.ok) {
        const json = await empRes.json();
        setEmployee(json.data);
        setReqPhone(json.data.phone || '');
        setReqPersonalEmail(json.data.emailPersonal || '');
      }
      if (histRes.ok) {
        const json = await histRes.json();
        setHistory(json.data || []);
      }
      if (docsRes.ok) {
        const json = await docsRes.json();
        setDocuments(json.data || []);
      }
      if (actRes.ok) {
        const json = await actRes.json();
        setActivityLogs(json.items || json.logs || []);
      }
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    loadEmployeeData();
  }, [loadEmployeeData]);

  // Handle Step-Up and Reveal Sensitive Fields
  const handleRevealSensitive = async (e: React.FormEvent) => {
    e.preventDefault();
    setElevating(true);
    setStepUpError(null);

    try {
      const stepUpRes = await fetch('/api/v1/auth/step-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: stepUpPassword }),
      });

      if (!stepUpRes.ok) {
        const err = await stepUpRes.json();
        throw new Error(err.error?.message || err.message || 'Invalid password verification.');
      }

      const sensitiveRes = await fetch(`/api/v1/employees/${employeeId}/sensitive`);
      if (!sensitiveRes.ok) {
        const err = await sensitiveRes.json();
        throw new Error(err.error?.message || err.message || 'Failed to retrieve sensitive data.');
      }

      const json = await sensitiveRes.json();
      setUnmaskedData(json.data);
      setStepUpOpen(false);
      setStepUpPassword('');
    } catch (err: unknown) {
      setStepUpError(err instanceof Error ? err.message : 'Step-up authentication failed.');
    } finally {
      setElevating(false);
    }
  };

  // Handle Job Assignment Change
  const handleJobChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangingJob(true);
    setJobChangeError(null);

    try {
      const res = await fetch(`/api/v1/employees/${employeeId}/job-change`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: jobField,
          newValue: newValue || null,
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
      loadEmployeeData();
    } catch (err: unknown) {
      setJobChangeError(err instanceof Error ? err.message : 'Error submitting job change.');
    } finally {
      setChangingJob(false);
    }
  };

  // Handle Document Upload Flow
  const handleUploadDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      setDocUploadError('Please select a file to upload.');
      return;
    }

    setUploadingDoc(true);
    setDocUploadError(null);

    try {
      // 1. Request presigned upload URL
      const presignRes = await fetch('/api/v1/files/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalName: selectedFile.name,
          mime: selectedFile.type || 'application/pdf',
          sizeBytes: selectedFile.size,
          ownerType: 'employee_document',
          ownerId: employeeId,
        }),
      });

      if (!presignRes.ok) {
        throw new Error('Failed to generate presigned upload URL.');
      }

      const presignData = await presignRes.json();
      const { fileId, uploadUrl } = presignData.data;

      // 2. Upload binary payload to S3 / MinIO
      const s3Res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': selectedFile.type || 'application/pdf' },
        body: selectedFile,
      });

      if (!s3Res.ok) {
        throw new Error('Failed to upload file bytes to storage.');
      }

      // 3. Confirm upload
      await fetch(`/api/v1/files/${fileId}/confirm`, { method: 'POST' });

      // 4. Link document to employee
      const docLinkRes = await fetch(`/api/v1/employees/${employeeId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: docType,
          fileId,
          expiry: docExpiry || null,
        }),
      });

      if (!docLinkRes.ok) {
        throw new Error('Failed to link document record.');
      }

      setDocModalOpen(false);
      setSelectedFile(null);
      setDocExpiry('');
      loadEmployeeData();
    } catch (err: unknown) {
      setDocUploadError(err instanceof Error ? err.message : 'Document upload failed.');
    } finally {
      setUploadingDoc(false);
    }
  };

  // Handle HR Document Verification
  const handleVerifyDocument = async () => {
    if (!verifyDocId) return;
    setVerifying(true);

    try {
      const res = await fetch(`/api/v1/employees/${employeeId}/documents/${verifyDocId}/verify`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: verifyDecision,
          comment: verifyComment || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || err.message || 'Failed to verify document.');
      }

      setVerifyDocId(null);
      setVerifyComment('');
      loadEmployeeData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Error verifying document.');
    } finally {
      setVerifying(false);
    }
  };

  // Handle Profile Change Request Submission
  const handleSubmitChangeRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingReq(true);
    setReqError(null);
    setReqSuccess(false);

    try {
      const res = await fetch(`/api/v1/employees/${employeeId}/change-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: reqPhone || undefined,
          emailPersonal: reqPersonalEmail || undefined,
          maritalStatus: reqMaritalStatus || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || err.message || 'Failed to submit request.');
      }

      setReqSuccess(true);
      setTimeout(() => {
        setChangeRequestOpen(false);
        setReqSuccess(false);
      }, 1500);
    } catch (err: unknown) {
      setReqError(err instanceof Error ? err.message : 'Error submitting request.');
    } finally {
      setSubmittingReq(false);
    }
  };

  if (loading && !employee) {
    return (
      <div className="p-8 max-w-6xl mx-auto space-y-6">
        <TableLoadingSkeleton rows={6} columns={4} />
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
    <div className="p-8 max-w-7xl mx-auto space-y-6">
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
            <div className="text-xs text-muted-foreground font-mono mt-1">
              {employee.empCode} • {employee.emailWork} • {employee.departmentName || 'General'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setJobModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-sm"
          >
            <Clock className="h-4 w-4" /> Change Job Assignment
          </button>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-border pb-3 overflow-x-auto">
        {(
          [
            { id: 'overview', label: 'Overview', icon: <User className="h-4 w-4" /> },
            { id: 'job_history', label: 'Job & Timeline', icon: <Clock className="h-4 w-4" /> },
            { id: 'documents', label: 'Document Vault', icon: <FileText className="h-4 w-4" /> },
            { id: 'personal', label: 'Personal & Contact', icon: <Briefcase className="h-4 w-4" /> },
            { id: 'sensitive', label: 'Sensitive IDs', icon: <Lock className="h-4 w-4" /> },
            { id: 'activity', label: 'Activity Logs', icon: <Activity className="h-4 w-4" /> },
          ] as const
        ).map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition ${
              activeTab === tab.id
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-6">
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Briefcase className="h-4 w-4 text-primary" /> Employment Details
              </h3>
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-muted-foreground block">Department</span>
                  <span className="font-semibold text-foreground">{employee.departmentName || 'None'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Designation</span>
                  <span className="font-semibold text-foreground">{employee.designationName || 'None'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Work Location</span>
                  <span className="font-semibold text-foreground">{employee.locationName || 'None'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Employment Type</span>
                  <span className="font-semibold text-foreground capitalize">{employee.employmentType.replace('_', ' ')}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Date of Joining</span>
                  <span className="font-semibold text-foreground font-mono">{employee.doj}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Effective From</span>
                  <span className="font-semibold text-foreground font-mono">{employee.jobEffectiveFrom}</span>
                </div>
              </div>
            </div>

            {/* Custom Attributes Panel */}
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" /> Custom Profile Attributes
              </h3>
              {employee.customFields && Object.keys(employee.customFields).length > 0 ? (
                <div className="grid grid-cols-2 gap-4 text-xs">
                  {Object.entries(employee.customFields).map(([key, val]) => (
                    <div key={key}>
                      <span className="text-muted-foreground block capitalize">{key.replace(/_/g, ' ')}</span>
                      <span className="font-semibold text-foreground">
                        {typeof val === 'object' ? JSON.stringify(val) : String(val ?? 'None')}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">No custom attributes recorded for this employee.</p>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <User className="h-4 w-4 text-primary" /> Reporting Manager
              </h3>
              {employee.managerName ? (
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center font-bold text-primary text-xs">
                    {employee.managerName.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-foreground">{employee.managerName}</div>
                    <div className="text-[11px] text-muted-foreground">Direct Supervisor</div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">No manager assigned (Top Level)</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: JOB & HISTORY TIMELINE */}
      {activeTab === 'job_history' && (
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" /> Effective-Dated Career Timeline
            </h3>
            <button
              onClick={() => setJobModalOpen(true)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-sm"
            >
              + Record Job Change
            </button>
          </div>

          {history.length === 0 ? (
            <EmptyState title="No history records found" description="Career history timeline is empty." />
          ) : (
            <div className="relative border-l border-border/80 pl-6 ml-4 space-y-6 pt-2">
              {history.map(item => (
                <div key={item.id} className="relative group">
                  <div className="absolute -left-[31px] top-1.5 h-3.5 w-3.5 rounded-full border-2 border-primary bg-background" />
                  <div className="p-4 rounded-xl border border-border bg-card/60 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-foreground capitalize">
                        {item.field.replace('Id', '')} changed
                      </span>
                      <span className="font-mono text-muted-foreground text-[11px]">
                        Effective: {item.effectiveFrom}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Value updated from{' '}
                      <strong className="text-foreground">{JSON.stringify(item.oldValue) || 'None'}</strong> to{' '}
                      <strong className="text-foreground">{JSON.stringify(item.newValue)}</strong>
                    </p>
                    {item.reason && (
                      <p className="text-[11px] text-primary/80 italic mt-1">Reason: {item.reason}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: DOCUMENT VAULT */}
      {activeTab === 'documents' && (
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" /> Employee Document Vault
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Secure S3 object storage with magic-byte verification and HR compliance approval.
              </p>
            </div>
            <button
              onClick={() => {
                setDocUploadError(null);
                setDocModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-sm"
            >
              <Upload className="h-3.5 w-3.5" /> Upload Document
            </button>
          </div>

          {documents.length === 0 ? (
            <EmptyState
              title="No documents uploaded yet"
              description="Upload identity proof, contracts, or educational records."
              action={
                <button
                  onClick={() => setDocModalOpen(true)}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground"
                >
                  Upload First Document
                </button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              {documents.map(doc => {
                const isVerified = doc.status === 'verified';
                const isRejected = doc.status === 'rejected';
                return (
                  <div
                    key={doc.id}
                    className="p-4 rounded-xl border border-border bg-card/60 flex flex-col justify-between gap-3 shadow-sm hover:border-primary/40 transition"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-primary/10 text-primary">
                          <FileCheck className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-foreground">{doc.type}</div>
                          <div className="text-[11px] text-muted-foreground font-mono">
                            {doc.originalName || 'document.pdf'}
                          </div>
                        </div>
                      </div>

                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium capitalize ${
                          isVerified
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                            : isRejected
                              ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {doc.status}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-muted-foreground border-t border-border/50 pt-2">
                      <span>Expiry: {doc.expiry || 'None'}</span>
                      <div className="flex items-center gap-2">
                        {doc.status === 'pending' && (
                          <button
                            onClick={() => {
                              setVerifyDocId(doc.id);
                              setVerifyDecision('verified');
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-muted text-foreground hover:bg-primary hover:text-white transition font-semibold"
                          >
                            Verify / Reject
                          </button>
                        )}
                        <a
                          href={`/api/v1/files/${doc.fileId}/url`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline font-semibold"
                        >
                          Download
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: PERSONAL & CONTACT */}
      {activeTab === 'personal' && (
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <User className="h-4 w-4 text-primary" /> Contact & Emergency Details
            </h3>
            <button
              onClick={() => {
                setReqError(null);
                setChangeRequestOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-sm"
            >
              <Send className="h-3.5 w-3.5" /> Request Profile Change
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-xs pt-2">
            <div>
              <span className="text-muted-foreground block">Phone</span>
              <span className="font-semibold text-foreground font-mono">{employee.phone || '—'}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Personal Email</span>
              <span className="font-semibold text-foreground font-mono">{employee.emailPersonal || '—'}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Marital Status</span>
              <span className="font-semibold text-foreground capitalize">Single</span>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: SENSITIVE IDS (WITH STEP-UP & AUDIT) */}
      {activeTab === 'sensitive' && (
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Lock className="h-4 w-4 text-primary" /> Encrypted Government & Financial IDs
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Values are AES-256-GCM encrypted in storage. Access requires step-up authentication and is logged in the compliance audit trail.
              </p>
            </div>

            {!unmaskedData && (
              <button
                type="button"
                onClick={() => setStepUpOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition self-start sm:self-auto border border-amber-500/20"
              >
                <Unlock className="h-3.5 w-3.5" /> Reveal Sensitive IDs
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
            <div className="p-4 rounded-xl border border-border bg-card/60 space-y-1">
              <span className="text-xs text-muted-foreground block font-medium">Permanent Account Number (PAN)</span>
              <span className="text-base font-bold font-mono tracking-wider text-foreground">
                {unmaskedData ? unmaskedData.pan || '—' : employee.pan || 'XXXXXXXXXX'}
              </span>
            </div>

            <div className="p-4 rounded-xl border border-border bg-card/60 space-y-1">
              <span className="text-xs text-muted-foreground block font-medium">Aadhaar (UIDAI)</span>
              <span className="text-base font-bold font-mono tracking-wider text-foreground">
                {unmaskedData ? unmaskedData.aadhaar || '—' : employee.aadhaar || 'XXXXXXXXXXXX'}
              </span>
            </div>

            <div className="p-4 rounded-xl border border-border bg-card/60 space-y-1">
              <span className="text-xs text-muted-foreground block font-medium">Bank Account Number</span>
              <span className="text-base font-bold font-mono tracking-wider text-foreground">
                {unmaskedData ? unmaskedData.bankAccount || '—' : employee.bankAccount || 'XXXXXXXXXXXX'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: ACTIVITY LOGS */}
      {activeTab === 'activity' && (
        <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
          <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" /> Profile Audit Trail
          </h3>
          {activityLogs.length === 0 ? (
            <EmptyState title="No recent activity logs" description="Audit events for this profile will appear here." />
          ) : (
            <div className="divide-y divide-border/60">
              {activityLogs.map(log => (
                <div key={log.id} className="py-3 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-semibold text-foreground font-mono">{log.action}</span>
                    <span className="text-muted-foreground text-[11px] block mt-0.5">
                      Actor: {log.actorRole || 'System'} • IP: {log.ip || 'Internal'}
                    </span>
                  </div>
                  <span className="font-mono text-muted-foreground text-[11px]">
                    {new Date(log.ts).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Step-Up Modal Dialog */}
      {stepUpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">Step-Up Verification</h3>
                <span className="text-xs text-muted-foreground">Confirm password to unmask</span>
              </div>
            </div>

            {stepUpError && (
              <div className="p-3 text-xs rounded-lg bg-destructive/10 text-destructive border border-destructive/20 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{stepUpError}</span>
              </div>
            )}

            <form onSubmit={handleRevealSensitive} className="space-y-4">
              <FormField label="Password" required>
                <Input
                  type="password"
                  required
                  value={stepUpPassword}
                  onChange={e => setStepUpPassword(e.target.value)}
                  placeholder="Enter your current password"
                />
              </FormField>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setStepUpOpen(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-lg border border-border hover:bg-muted/40 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={elevating}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-sm disabled:opacity-50"
                >
                  {elevating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Confirm & Unmask
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Document Upload Modal */}
      {docModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground">Upload Document</h3>
              <button
                onClick={() => setDocModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {docUploadError && (
              <div className="p-3 text-xs rounded-lg bg-destructive/10 text-destructive border border-destructive/20 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{docUploadError}</span>
              </div>
            )}

            <form onSubmit={handleUploadDocument} className="space-y-4">
              <FormField label="Document Type" required>
                <Select
                  value={docType}
                  onChange={e => setDocType(e.target.value)}
                  options={[
                    { label: 'Identity Proof (PAN / Aadhaar)', value: 'Identity Proof' },
                    { label: 'Passport', value: 'Passport' },
                    { label: 'Employment Contract', value: 'Contract' },
                    { label: 'Degree / Certificate', value: 'Education' },
                    { label: 'Other Attachment', value: 'Other' },
                  ]}
                />
              </FormField>

              <FormField label="Select File (PDF, PNG, JPEG)" required>
                <Input
                  type="file"
                  required
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={e => setSelectedFile(e.target.files?.[0] || null)}
                />
              </FormField>

              <FormField label="Expiry Date (optional)">
                <Input
                  type="date"
                  value={docExpiry}
                  onChange={e => setDocExpiry(e.target.value)}
                />
              </FormField>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setDocModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-lg border border-border hover:bg-muted/40 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploadingDoc}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-sm disabled:opacity-50"
                >
                  {uploadingDoc && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Upload to Vault
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Document Verification Modal */}
      {verifyDocId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-foreground">Verify Employee Document</h3>
            <p className="text-xs text-muted-foreground">
              Review and record compliance decision for this document.
            </p>

            <div className="space-y-3">
              <FormField label="Verification Decision" required>
                <Select
                  value={verifyDecision}
                  onChange={e => setVerifyDecision(e.target.value as 'verified' | 'rejected')}
                  options={[
                    { label: 'Verify (Approve document)', value: 'verified' },
                    { label: 'Reject (Document unreadable or invalid)', value: 'rejected' },
                  ]}
                />
              </FormField>

              <FormField label="Compliance Comment (optional)">
                <Textarea
                  value={verifyComment}
                  onChange={e => setVerifyComment(e.target.value)}
                  placeholder="e.g. Validated against government database."
                />
              </FormField>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setVerifyDocId(null)}
                  className="px-4 py-2 text-xs font-semibold rounded-lg border border-border hover:bg-muted/40 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleVerifyDocument}
                  disabled={verifying}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-sm"
                >
                  {verifying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Submit Decision
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Profile Change Request Modal */}
      {changeRequestOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground">Request Profile Change</h3>
              <button
                onClick={() => setChangeRequestOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {reqSuccess && (
              <div className="p-3 text-xs rounded-lg bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 flex items-center gap-2">
                <Check className="h-4 w-4 shrink-0" />
                <span>Profile change request submitted to manager/HR for approval.</span>
              </div>
            )}

            {reqError && (
              <div className="p-3 text-xs rounded-lg bg-destructive/10 text-destructive border border-destructive/20 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{reqError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitChangeRequest} className="space-y-4">
              <FormField label="Phone Number">
                <Input
                  value={reqPhone}
                  onChange={e => setReqPhone(e.target.value)}
                  placeholder="+91 9876543210"
                />
              </FormField>

              <FormField label="Personal Email">
                <Input
                  type="email"
                  value={reqPersonalEmail}
                  onChange={e => setReqPersonalEmail(e.target.value)}
                  placeholder="personal@gmail.com"
                />
              </FormField>

              <FormField label="Marital Status">
                <Select
                  value={reqMaritalStatus}
                  onChange={e => setReqMaritalStatus(e.target.value)}
                  options={[
                    { label: 'Single', value: 'single' },
                    { label: 'Married', value: 'married' },
                    { label: 'Other', value: 'other' },
                  ]}
                />
              </FormField>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setChangeRequestOpen(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-lg border border-border hover:bg-muted/40 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingReq}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-sm disabled:opacity-50"
                >
                  {submittingReq && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Job Assignment Modal */}
      {jobModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground">Change Job Assignment</h3>
              <button
                onClick={() => setJobModalOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {jobChangeError && (
              <div className="p-3 text-xs rounded-lg bg-destructive/10 text-destructive border border-destructive/20 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{jobChangeError}</span>
              </div>
            )}

            <form onSubmit={handleJobChange} className="space-y-4">
              <FormField label="Assignment Field" required>
                <Select
                  value={jobField}
                  onChange={e =>
                    setJobField(
                      e.target.value as 'departmentId' | 'designationId' | 'managerId' | 'status',
                    )
                  }
                  options={[
                    { label: 'Designation', value: 'designationId' },
                    { label: 'Department', value: 'departmentId' },
                    { label: 'Manager', value: 'managerId' },
                    { label: 'Employment Status', value: 'status' },
                  ]}
                />
              </FormField>

              <FormField label="New Value (UUID or Status code)" required>
                <Input
                  required
                  value={newValue}
                  onChange={e => setNewValue(e.target.value)}
                  placeholder="Enter target ID or status"
                />
              </FormField>

              <FormField label="Effective Date" required>
                <Input
                  type="date"
                  required
                  value={effectiveFrom}
                  onChange={e => setEffectiveFrom(e.target.value)}
                />
              </FormField>

              <FormField label="Reason for Change">
                <Input
                  value={changeReason}
                  onChange={e => setChangeReason(e.target.value)}
                  placeholder="e.g. Annual Promotion / Reorganization"
                />
              </FormField>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setJobModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-lg border border-border hover:bg-muted/40 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={changingJob}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-sm disabled:opacity-50"
                >
                  {changingJob && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Record Change
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
