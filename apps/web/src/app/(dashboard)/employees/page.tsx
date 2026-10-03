'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Users,
  Plus,
  Search,
  CheckCircle,
  Building,
  Briefcase,
  X,
  AlertCircle,
  Eye,
  CreditCard,
  FileText,
  UserCheck,
} from 'lucide-react';

interface MaskedEmployee {
  id: string;
  empCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  emailWork: string;
  phone: string | null;
  departmentId: string | null;
  departmentName?: string | null;
  designationId: string | null;
  designationName?: string | null;
  locationName?: string | null;
  managerName?: string | null;
  status: string;
  doj: string;
  pan: string | null;
  aadhaar: string | null;
  bankAccount: string | null;
}

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<MaskedEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);

  // Form State for New Employee
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

  const loadEmployees = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/v1/employees');
      if (res.ok) {
        const json = await res.json();
        setEmployees(json.data || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEmployees();
  }, []);

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
      await loadEmployees();
    } catch (err: unknown) {
      setFormError((err as Error).message || 'Failed to create employee.');
    } finally {
      setSaving(false);
    }
  };

  const filtered = employees.filter(e =>
    e.fullName.toLowerCase().includes(search.toLowerCase()) ||
    e.empCode.toLowerCase().includes(search.toLowerCase()) ||
    e.emailWork.toLowerCase().includes(search.toLowerCase()) ||
    (e.departmentName && e.departmentName.toLowerCase().includes(search.toLowerCase())) ||
    (e.designationName && e.designationName.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Users className="h-7 w-7 text-primary" />
            Employee Directory
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Master records with atomic code sequence, encrypted sensitive identity fields, and reporting hierarchies.
          </p>
        </div>
        <button
          onClick={openCreateDialog}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Add Employee
        </button>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-center bg-card p-4 rounded-xl border border-border shadow-sm">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name, code, email, dept..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition"
          />
        </div>
        <div className="text-xs text-muted-foreground font-medium">
          Showing {filtered.length} of {employees.length} employees
        </div>
      </div>

      {/* Directory Table */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-muted-foreground animate-pulse">
            Loading employee directory...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="mx-auto h-12 w-12 text-muted-foreground/40 mb-3" />
            <h3 className="text-base font-semibold text-foreground">No employees found</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
              Get started by adding employees to your company directory.
            </p>
            <button
              onClick={openCreateDialog}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition"
            >
              <Plus className="h-4 w-4" /> Add Employee
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 border-b border-border text-xs uppercase text-muted-foreground font-semibold">
                <tr>
                  <th className="py-3.5 px-6">Employee</th>
                  <th className="py-3.5 px-6">Role & Department</th>
                  <th className="py-3.5 px-6">Manager</th>
                  <th className="py-3.5 px-6">Identity (Masked)</th>
                  <th className="py-3.5 px-6">Status</th>
                  <th className="py-3.5 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(emp => (
                  <tr key={emp.id} className="hover:bg-muted/30 transition">
                    <td className="py-4 px-6">
                      <div className="font-semibold text-foreground">{emp.fullName}</div>
                      <div className="text-xs text-muted-foreground font-mono mt-0.5">
                        {emp.empCode} • {emp.emailWork}
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <div className="text-foreground font-medium flex items-center gap-1.5">
                        <Briefcase className="h-3 w-3 text-primary shrink-0" />
                        <span>{emp.designationName || 'No designation'}</span>
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                        <Building className="h-3 w-3 shrink-0" />
                        <span>{emp.departmentName || 'No department'}</span>
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      {emp.managerName ? (
                        <div className="text-xs text-foreground font-medium flex items-center gap-1">
                          <UserCheck className="h-3 w-3 text-emerald-500" />
                          {emp.managerName}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/60 italic">Top Leadership</span>
                      )}
                    </td>
                    <td className="py-4 px-6">
                      <div className="space-y-0.5 text-xs font-mono">
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <FileText className="h-3 w-3 shrink-0" />
                          <span>PAN: {emp.pan || 'N/A'}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <CreditCard className="h-3 w-3 shrink-0" />
                          <span>Bank: {emp.bankAccount || 'N/A'}</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 capitalize">
                        <CheckCircle className="h-3 w-3" />
                        {emp.status}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-right">
                      <Link
                        href={`/employees/${emp.id}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border hover:bg-muted text-foreground transition"
                      >
                        <Eye className="h-3.5 w-3.5" /> View Profile
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Employee Modal */}
      {dialogOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                Add New Employee
              </h2>
              <button
                onClick={() => setDialogOpen(false)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="overflow-y-auto p-6 space-y-4">
              {formError && (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">First Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Rahul"
                    value={firstName}
                    onChange={e => setFirstName(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">Last Name *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Sharma"
                    value={lastName}
                    onChange={e => setLastName(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">Work Email *</label>
                  <input
                    type="email"
                    required
                    placeholder="rahul.sharma@company.com"
                    value={emailWork}
                    onChange={e => setEmailWork(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">Phone</label>
                  <input
                    type="text"
                    placeholder="+91 9876543210"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">Date of Joining (DOJ) *</label>
                  <input
                    type="date"
                    required
                    value={doj}
                    onChange={e => setDoj(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">Employment Type *</label>
                  <select
                    value={employmentType}
                    onChange={e => setEmploymentType(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  >
                    <option value="full_time">Full Time</option>
                    <option value="part_time">Part Time</option>
                    <option value="contract">Contract</option>
                    <option value="intern">Intern</option>
                  </select>
                </div>
              </div>

              {/* Sensitive Identity Fields */}
              <div className="p-4 rounded-xl border border-border bg-muted/20 space-y-3">
                <div className="flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-primary" />
                  <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                    Sensitive Financial & Identity Fields (AES-256 Encrypted)
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Encrypted at application level with key rotation and HMAC blind indexing for PAN duplicates.
                </p>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-foreground mb-1">PAN Card</label>
                    <input
                      type="text"
                      placeholder="ABCDE1234F"
                      maxLength={10}
                      value={pan}
                      onChange={e => setPan(e.target.value.toUpperCase())}
                      className="w-full px-2.5 py-1.5 text-xs rounded border border-input bg-background focus:ring-2 focus:ring-primary/20 outline-none font-mono uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-foreground mb-1">Aadhaar (12 Digits)</label>
                    <input
                      type="text"
                      placeholder="123456789012"
                      maxLength={12}
                      value={aadhaar}
                      onChange={e => setAadhaar(e.target.value.replace(/\D/g, ''))}
                      className="w-full px-2.5 py-1.5 text-xs rounded border border-input bg-background focus:ring-2 focus:ring-primary/20 outline-none font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-foreground mb-1">Bank Account</label>
                    <input
                      type="text"
                      placeholder="Account Number"
                      value={bankAccount}
                      onChange={e => setBankAccount(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded border border-input bg-background focus:ring-2 focus:ring-primary/20 outline-none font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-border flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setDialogOpen(false)}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-border hover:bg-muted transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-sm disabled:opacity-50"
                >
                  {saving ? 'Creating Employee...' : 'Create Employee'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
