'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Users,
  Plus,
  Eye,
  CheckCircle,
  X,
  AlertCircle,
} from 'lucide-react';
import { DataTable, type ColumnDef } from '../../../components/ui/DataTable.js';
import { FormField, Input, Select } from '../../../components/ui/FormKit.js';

interface DirectoryEmployee {
  id: string;
  empCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  emailWork: string;
  phone: string | null;
  departmentId: string | null;
  departmentName: string | null;
  designationId: string | null;
  designationName: string | null;
  locationId: string | null;
  locationName: string | null;
  status: string;
  employmentType: string;
  doj: string;
  createdAt: string;
}

interface OrgMeta {
  departments: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<DirectoryEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState<number | undefined>();
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'probation' | 'notice'>('all');

  // Filters
  const [deptFilter, setDeptFilter] = useState('');
  const [locFilter, setLocFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [orgMeta, setOrgMeta] = useState<OrgMeta>({ departments: [], locations: [] });

  // Create Modal State
  const [dialogOpen, setDialogOpen] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [emailWork, setEmailWork] = useState('');
  const [phone, setPhone] = useState('');
  const [doj, setDoj] = useState(new Date().toISOString().slice(0, 10));
  const [employmentType, setEmploymentType] = useState('full_time');
  const [pan, setPan] = useState('');
  const [aadhaar, setAadhaar] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Load Org Metadata
  useEffect(() => {
    async function loadMeta() {
      try {
        const [deptRes, locRes] = await Promise.all([
          fetch('/api/v1/org/departments'),
          fetch('/api/v1/org/locations'),
        ]);
        const depts = deptRes.ok ? (await deptRes.json()).data || [] : [];
        const locs = locRes.ok ? (await locRes.json()).data || [] : [];
        setOrgMeta({ departments: depts, locations: locs });
      } catch {
        // Fallback
      }
    }
    loadMeta();
  }, []);

  const loadDirectory = useCallback(
    async (cursor?: string) => {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (search.trim()) params.set('search', search.trim());
        if (deptFilter) params.set('departmentId', deptFilter);
        if (locFilter) params.set('locationId', locFilter);

        const effectiveStatus =
          activeTab === 'all'
            ? statusFilter
            : activeTab === 'active'
              ? 'active'
              : activeTab === 'probation'
                ? 'probation'
                : 'notice';
        if (effectiveStatus) params.set('status', effectiveStatus);

        if (cursor) params.set('cursor', cursor);
        params.set('limit', '50');

        const res = await fetch(`/api/v1/employees/directory?${params.toString()}`);
        if (res.ok) {
          const json = await res.json();
          setEmployees(json.data || []);
          setNextCursor(json.nextCursor);
          setTotal(json.total);
        }
      } finally {
        setLoading(false);
      }
    },
    [search, deptFilter, locFilter, statusFilter, activeTab],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setCursorHistory([]);
      loadDirectory();
    }, 250);
    return () => clearTimeout(timer);
  }, [search, deptFilter, locFilter, statusFilter, activeTab, loadDirectory]);

  const handleNextPage = () => {
    if (nextCursor) {
      setCursorHistory(prev => [...prev, nextCursor]);
      loadDirectory(nextCursor);
    }
  };

  const handlePrevPage = () => {
    if (cursorHistory.length > 0) {
      const newHistory = [...cursorHistory];
      newHistory.pop();
      const prevCursor = newHistory[newHistory.length - 1];
      setCursorHistory(newHistory);
      loadDirectory(prevCursor);
    }
  };

  const openCreateDialog = () => {
    setFirstName('');
    setLastName('');
    setEmailWork('');
    setPhone('');
    setDoj(new Date().toISOString().slice(0, 10));
    setEmploymentType('full_time');
    setPan('');
    setAadhaar('');
    setBankAccount('');
    setFormError(null);
    setDialogOpen(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);

    const payload = {
      firstName,
      lastName,
      emailWork,
      phone: phone || null,
      doj,
      employmentType,
      pan: pan ? pan.toUpperCase() : null,
      aadhaar: aadhaar || null,
      bankAccount: bankAccount || null,
    };

    try {
      const res = await fetch('/api/v1/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || err.message || 'Failed to create employee.');
      }

      setDialogOpen(false);
      loadDirectory();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Error creating employee.');
    } finally {
      setSaving(false);
    }
  };

  // Define Table Columns
  const columns: ColumnDef<DirectoryEmployee>[] = [
    {
      id: 'empCode',
      header: 'EMP ID',
      accessorKey: 'empCode',
      sortable: true,
      cell: row => (
        <span className="font-mono text-xs text-muted-foreground">{row.empCode}</span>
      ),
    },
    {
      id: 'fullName',
      header: 'Employee Name',
      accessorKey: 'fullName',
      sortable: true,
      cell: row => (
        <Link
          href={`/employees/${row.id}`}
          className="flex items-center gap-3 font-semibold text-foreground hover:text-primary transition group"
        >
          <div className="h-8 w-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center font-bold text-primary text-xs shadow-inner">
            {row.firstName.charAt(0)}
            {row.lastName.charAt(0)}
          </div>
          <div>
            <div className="group-hover:underline">{row.fullName}</div>
            <div className="text-[11px] text-muted-foreground font-normal">{row.emailWork}</div>
          </div>
        </Link>
      ),
    },
    {
      id: 'departmentName',
      header: 'Department',
      accessorKey: 'departmentName',
      cell: row => (
        <span className="text-foreground/80">{row.departmentName || '—'}</span>
      ),
    },
    {
      id: 'designationName',
      header: 'Designation',
      accessorKey: 'designationName',
      cell: row => (
        <span className="text-foreground/80">{row.designationName || '—'}</span>
      ),
    },
    {
      id: 'locationName',
      header: 'Location',
      accessorKey: 'locationName',
      cell: row => (
        <span className="text-foreground/80">{row.locationName || '—'}</span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessorKey: 'status',
      cell: row => {
        const isAct = row.status === 'active';
        const isProb = row.status === 'probation';
        const isNotice = row.status === 'notice';
        return (
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium capitalize ${
              isAct
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : isProb
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : isNotice
                    ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                    : 'bg-muted text-muted-foreground'
            }`}
          >
            {isAct && <CheckCircle className="h-3 w-3" />}
            {row.status}
          </span>
        );
      },
    },
    {
      id: 'doj',
      header: 'Date of Joining',
      accessorKey: 'doj',
      cell: row => <span className="text-muted-foreground font-mono">{row.doj}</span>,
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: row => (
        <Link
          href={`/employees/${row.id}`}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border border-border hover:bg-muted/40 transition text-muted-foreground hover:text-foreground"
        >
          <Eye className="h-3.5 w-3.5" /> View Profile
        </Link>
      ),
    },
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Employee Directory</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Enterprise staff directory powered by pg_trgm similarity search and keyset pagination.
          </p>
        </div>

        <button
          onClick={openCreateDialog}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-sm self-start md:self-auto"
        >
          <Plus className="h-4 w-4" /> Add Employee
        </button>
      </div>

      {/* Saved View Presets / Pills */}
      <div className="flex items-center gap-2 border-b border-border pb-3 overflow-x-auto">
        {(
          [
            { id: 'all', label: 'All Employees' },
            { id: 'active', label: 'Active' },
            { id: 'probation', label: 'On Probation' },
            { id: 'notice', label: 'Notice Period' },
          ] as const
        ).map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${
              activeTab === tab.id
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Data Table */}
      <DataTable
        columns={columns}
        data={employees}
        loading={loading}
        total={total}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by name, emp code, or email..."
        exportFilename="employee_directory.csv"
        hasMore={Boolean(nextCursor)}
        onNextPage={handleNextPage}
        onPrevPage={handlePrevPage}
        pageIndex={cursorHistory.length}
        filterSlot={
          <div className="flex items-center gap-2">
            <select
              value={deptFilter}
              onChange={e => setDeptFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-border bg-card/60 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All Departments</option>
              {orgMeta.departments.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>

            <select
              value={locFilter}
              onChange={e => setLocFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs rounded-lg border border-border bg-card/60 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">All Locations</option>
              {orgMeta.locations.map(l => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>

            {activeTab === 'all' && (
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-border bg-card/60 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">All Statuses</option>
                <option value="active">Active</option>
                <option value="probation">Probation</option>
                <option value="notice">Notice</option>
                <option value="terminated">Terminated</option>
              </select>
            )}
          </div>
        }
      />

      {/* Add Employee Modal */}
      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-base font-bold text-foreground">Add New Employee</h3>
              <button
                onClick={() => setDialogOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded-md"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 text-xs rounded-lg bg-destructive/10 text-destructive border border-destructive/20 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField label="First Name" required>
                  <Input
                    required
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    placeholder="e.g. Rahul"
                  />
                </FormField>
                <FormField label="Last Name" required>
                  <Input
                    required
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    placeholder="e.g. Sharma"
                  />
                </FormField>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField label="Work Email" required>
                  <Input
                    type="email"
                    required
                    value={emailWork}
                    onChange={e => setEmailWork(e.target.value)}
                    placeholder="rahul.sharma@company.com"
                  />
                </FormField>
                <FormField label="Phone">
                  <Input
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="+91 9876543210"
                  />
                </FormField>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormField label="Date of Joining" required>
                  <Input
                    type="date"
                    required
                    value={doj}
                    onChange={e => setDoj(e.target.value)}
                  />
                </FormField>
                <FormField label="Employment Type">
                  <Select
                    value={employmentType}
                    onChange={e => setEmploymentType(e.target.value)}
                    options={[
                      { label: 'Full Time', value: 'full_time' },
                      { label: 'Part Time', value: 'part_time' },
                      { label: 'Contract', value: 'contract' },
                      { label: 'Intern', value: 'intern' },
                    ]}
                  />
                </FormField>
              </div>

              <div className="border-t border-border pt-3 space-y-3">
                <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Sensitive Government & Bank IDs (AES-256 Encrypted)
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="PAN">
                    <Input
                      value={pan}
                      onChange={e => setPan(e.target.value)}
                      placeholder="ABCDE1234F"
                    />
                  </FormField>
                  <FormField label="Aadhaar">
                    <Input
                      value={aadhaar}
                      onChange={e => setAadhaar(e.target.value)}
                      placeholder="12-digit UIDAI"
                    />
                  </FormField>
                </div>
                <FormField label="Bank Account Number">
                  <Input
                    value={bankAccount}
                    onChange={e => setBankAccount(e.target.value)}
                    placeholder="Account number"
                  />
                </FormField>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setDialogOpen(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-lg border border-border hover:bg-muted/40 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-sm disabled:opacity-50"
                >
                  {saving ? 'Saving Employee...' : 'Create Employee'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
