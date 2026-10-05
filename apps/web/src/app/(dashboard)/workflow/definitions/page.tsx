'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  GitBranch,
  Play,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Layers,
  RefreshCw,
  X,
  Sliders,
} from 'lucide-react';

interface StepDefinition {
  stepIndex: number;
  name: string;
  mode: 'any' | 'all';
  resolver: {
    type: 'role' | 'reporting_manager' | 'department_head' | 'user';
    roleName?: string;
    userId?: string;
  };
  condition?: {
    field?: string;
    op: '==' | '!=' | '>' | '<' | '>=' | '<=' | 'in' | 'contains';
    value?: unknown;
  } | null;
  selfApproval?: 'allow' | 'skip' | 'escalate';
  slaHours?: number;
  reminderHours?: number;
}

interface WorkflowDefinition {
  id: string;
  code: string;
  name: string;
  entityType: string;
  version: number;
  isActive: boolean;
  steps: StepDefinition[];
  createdAt: string;
}

interface SimulationResult {
  steps: Array<{
    stepIndex: number;
    name: string;
    mode: 'any' | 'all';
    conditionMet: boolean;
    approverType: string;
    approverRole?: string;
    slaHours?: number;
  }>;
  autoApproved: boolean;
  activeStepCount: number;
}

export default function WorkflowDefinitionsPage() {
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Editor Modal State
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [wfCode, setWfCode] = useState('');
  const [wfName, setWfName] = useState('');
  const [wfEntity, setWfEntity] = useState('employee');
  const [wfSteps, setWfSteps] = useState<StepDefinition[]>([
    {
      stepIndex: 0,
      name: 'Manager Approval',
      mode: 'any',
      resolver: { type: 'reporting_manager' },
      condition: null,
      selfApproval: 'skip',
      slaHours: 24,
    },
  ]);
  const [isSaving, setIsSaving] = useState(false);

  // Simulator Drawer State
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);
  const [simSelectedCode, setSimSelectedCode] = useState('');
  const [simPayloadJson, setSimPayloadJson] = useState('{\n  "employeeId": "emp-101",\n  "department": "Engineering",\n  "days": 4,\n  "changes": { "phone": "+919876543210" }\n}');
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);

  const fetchDefinitions = useCallback(async () => {
    try {
      setIsLoading(true);
      setErrorToast(null);

      const res = await fetch('/api/v1/workflow/definitions');
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message || 'Failed to load workflow definitions.');
      }

      const json = await res.json();
      setDefinitions(json.data || []);
      if (json.data && json.data.length > 0 && !simSelectedCode) {
        setSimSelectedCode(json.data[0].code);
      }
    } catch (err: unknown) {
      setErrorToast(err instanceof Error ? err.message : 'Error fetching definitions.');
    } finally {
      setIsLoading(false);
    }
  }, [simSelectedCode]);

  useEffect(() => {
    fetchDefinitions();
  }, [fetchDefinitions]);

  const handleAddStep = () => {
    setWfSteps(prev => [
      ...prev,
      {
        stepIndex: prev.length,
        name: `Step ${prev.length + 1} Review`,
        mode: 'any',
        resolver: { type: 'role', roleName: 'hr_admin' },
        condition: null,
        selfApproval: 'allow',
        slaHours: 48,
      },
    ]);
  };

  const handleRemoveStep = (idx: number) => {
    setWfSteps(prev => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, stepIndex: i })));
  };

  const handleSaveDefinition = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSaving(true);
      setErrorToast(null);

      const res = await fetch('/api/v1/workflow/definitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: wfCode.trim().toLowerCase(),
          name: wfName.trim(),
          entityType: wfEntity.trim(),
          steps: wfSteps,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || 'Failed to save workflow definition.');
      }

      setSuccessToast(`Workflow '${wfName}' saved successfully (Version ${json.data.version}).`);
      setIsEditorOpen(false);
      setWfCode('');
      setWfName('');
      fetchDefinitions();
    } catch (err: unknown) {
      setErrorToast(err instanceof Error ? err.message : 'Failed to save workflow.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRunSimulation = async () => {
    try {
      setIsSimulating(true);
      setErrorToast(null);

      let parsedPayload: Record<string, unknown> = {};
      try {
        parsedPayload = JSON.parse(simPayloadJson);
      } catch {
        throw new Error('Simulation payload must be valid JSON.');
      }

      const res = await fetch('/api/v1/workflow/definitions/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          definitionCode: simSelectedCode || undefined,
          payload: parsedPayload,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || 'Simulation execution failed.');
      }

      setSimResult(json.data);
    } catch (err: unknown) {
      setErrorToast(err instanceof Error ? err.message : 'Error running dry-run simulator.');
    } finally {
      setIsSimulating(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <GitBranch className="h-6 w-6 text-purple-600" />
            Workflow Definitions & Dry-Run Simulator
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Build multi-step approval workflows, condition trees, SLAs, and test routing logic.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setSimResult(null);
              setIsSimulatorOpen(true);
            }}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-bold text-purple-700 bg-purple-50 border border-purple-200 rounded-xl hover:bg-purple-100 transition shadow-sm"
          >
            <Play className="h-3.5 w-3.5" />
            Dry-Run Simulator
          </button>
          <button
            onClick={() => {
              setWfCode('');
              setWfName('');
              setWfSteps([
                {
                  stepIndex: 0,
                  name: 'Manager Approval',
                  mode: 'any',
                  resolver: { type: 'reporting_manager' },
                  condition: null,
                  selfApproval: 'skip',
                  slaHours: 24,
                },
              ]);
              setIsEditorOpen(true);
            }}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-500 rounded-xl transition shadow"
          >
            <Plus className="h-4 w-4" />
            New Workflow
          </button>
        </div>
      </div>

      {/* Toasts */}
      {successToast && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <span>{successToast}</span>
          </div>
          <button onClick={() => setSuccessToast(null)} className="text-emerald-600 text-xs font-semibold">
            Dismiss
          </button>
        </div>
      )}

      {errorToast && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-rose-600" />
            <span>{errorToast}</span>
          </div>
          <button onClick={() => setErrorToast(null)} className="text-rose-600 text-xs font-semibold">
            Dismiss
          </button>
        </div>
      )}

      {/* Definitions Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {isLoading ? (
          <div className="col-span-full py-16 text-center text-slate-400">
            <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-slate-400" />
            Loading workflow definitions...
          </div>
        ) : definitions.length === 0 ? (
          <div className="col-span-full py-16 text-center text-slate-400 bg-white border rounded-2xl p-8">
            <Layers className="h-8 w-8 text-slate-300 mx-auto mb-2" />
            <p className="font-semibold text-slate-700">No workflow definitions found.</p>
            <p className="text-xs text-slate-400 mt-1">Create your first definition to get started.</p>
          </div>
        ) : (
          definitions.map(wf => (
            <div
              key={wf.id}
              className="bg-white border rounded-2xl p-5 shadow-sm hover:shadow-md transition space-y-4 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-bold text-slate-900 text-base">{wf.name}</h3>
                    <p className="font-mono text-xs text-purple-600 mt-0.5">{wf.code}</p>
                  </div>
                  <span className="bg-purple-100 text-purple-800 text-[11px] font-bold px-2 py-0.5 rounded-full">
                    v{wf.version}
                  </span>
                </div>

                <div className="mt-3 text-xs text-slate-500 space-y-1">
                  <p>Entity: <span className="font-medium text-slate-700">{wf.entityType}</span></p>
                  <p>Total Steps: <span className="font-semibold text-slate-800">{wf.steps?.length || 0}</span></p>
                </div>

                {/* Step Pipeline Preview */}
                <div className="mt-4 pt-3 border-t space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Pipeline</p>
                  <div className="space-y-1.5">
                    {wf.steps?.map((step, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs text-slate-700">
                        <span className="h-5 w-5 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[10px] font-bold">
                          {idx + 1}
                        </span>
                        <span className="font-medium truncate">{step.name}</span>
                        <span className="text-[10px] text-slate-400 ml-auto capitalize">
                          {step.resolver.type.replace('_', ' ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t flex justify-end gap-2">
                <button
                  onClick={() => {
                    setSimSelectedCode(wf.code);
                    setIsSimulatorOpen(true);
                  }}
                  className="px-3 py-1.5 text-xs font-bold text-purple-700 hover:bg-purple-50 rounded-lg transition inline-flex items-center gap-1.5"
                >
                  <Play className="h-3 w-3" />
                  Simulate
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Editor Modal */}
      {isEditorOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 space-y-5 shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-slate-900 text-lg flex items-center gap-2">
                <Sliders className="h-5 w-5 text-purple-600" />
                Workflow Step Builder
              </h3>
              <button onClick={() => setIsEditorOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveDefinition} className="flex-1 overflow-y-auto space-y-4 pr-1 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Workflow Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Profile Change Request"
                    value={wfName}
                    onChange={e => setWfName(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-purple-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Workflow Code (snake_case)</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. profile_change"
                    value={wfCode}
                    onChange={e => setWfCode(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-purple-500 focus:outline-none font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Entity Type</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. change_request"
                  value={wfEntity}
                  onChange={e => setWfEntity(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-purple-500 focus:outline-none"
                />
              </div>

              {/* Steps List */}
              <div className="pt-2 border-t space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-800 text-sm">Configured Steps ({wfSteps.length})</h4>
                  <button
                    type="button"
                    onClick={handleAddStep}
                    className="px-2.5 py-1 text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 rounded-lg transition inline-flex items-center gap-1"
                  >
                    <Plus className="h-3 w-3" />
                    Add Step
                  </button>
                </div>

                <div className="space-y-3">
                  {wfSteps.map((step, idx) => (
                    <div key={idx} className="p-3 bg-slate-50 border rounded-xl space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-800 flex items-center gap-2">
                          <span className="h-5 w-5 rounded-full bg-purple-600 text-white flex items-center justify-center text-[10px]">
                            {idx + 1}
                          </span>
                          Step {idx + 1}
                        </span>
                        {wfSteps.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveStep(idx)}
                            className="text-rose-500 hover:text-rose-700 p-1"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">Step Name</label>
                          <input
                            type="text"
                            required
                            value={step.name}
                            onChange={e => {
                              const val = e.target.value;
                              setWfSteps(prev => prev.map((s, i) => (i === idx ? { ...s, name: val } : s)));
                            }}
                            className="w-full border rounded-lg px-2.5 py-1.5 bg-white text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">Approver Type</label>
                          <select
                            value={step.resolver.type}
                            onChange={e => {
                              const val = e.target.value as 'role' | 'reporting_manager' | 'department_head' | 'user';
                              setWfSteps(prev =>
                                prev.map((s, i) => (i === idx ? { ...s, resolver: { type: val, roleName: val === 'role' ? 'hr_admin' : undefined } } : s)),
                              );
                            }}
                            className="w-full border rounded-lg px-2.5 py-1.5 bg-white text-xs"
                          >
                            <option value="reporting_manager">Direct Reporting Manager</option>
                            <option value="role">Specific Role (e.g. HR Admin)</option>
                            <option value="department_head">Department Head</option>
                            <option value="user">Specific User ID</option>
                          </select>
                        </div>
                      </div>

                      {step.resolver.type === 'role' && (
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">Target Role</label>
                          <input
                            type="text"
                            placeholder="e.g. hr_admin, finance_manager"
                            value={step.resolver.roleName || ''}
                            onChange={e => {
                              const val = e.target.value;
                              setWfSteps(prev =>
                                prev.map((s, i) => (i === idx ? { ...s, resolver: { ...s.resolver, roleName: val } } : s)),
                              );
                            }}
                            className="w-full border rounded-lg px-2.5 py-1.5 bg-white text-xs"
                          />
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">SLA Timeout (Hours)</label>
                          <input
                            type="number"
                            min={1}
                            max={720}
                            value={step.slaHours || 24}
                            onChange={e => {
                              const val = parseInt(e.target.value, 10);
                              setWfSteps(prev => prev.map((s, i) => (i === idx ? { ...s, slaHours: val } : s)));
                            }}
                            className="w-full border rounded-lg px-2.5 py-1.5 bg-white text-xs"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">Self Approval</label>
                          <select
                            value={step.selfApproval || 'skip'}
                            onChange={e => {
                              const val = e.target.value as 'allow' | 'skip' | 'escalate';
                              setWfSteps(prev => prev.map((s, i) => (i === idx ? { ...s, selfApproval: val } : s)));
                            }}
                            className="w-full border rounded-lg px-2.5 py-1.5 bg-white text-xs"
                          >
                            <option value="skip">Skip if Requester</option>
                            <option value="allow">Allow</option>
                            <option value="escalate">Escalate</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <button
                  type="button"
                  onClick={() => setIsEditorOpen(false)}
                  className="px-4 py-2 border rounded-lg text-slate-600 hover:bg-slate-50 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg transition disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save Definition'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Simulator Drawer */}
      {isSimulatorOpen && (
        <div className="fixed inset-y-0 right-0 w-full sm:w-[500px] bg-white shadow-2xl z-50 border-l flex flex-col">
          <div className="p-4 border-b flex items-center justify-between bg-purple-50/50">
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Play className="h-5 w-5 text-purple-600" />
                Dry-Run Simulation Sandbox
              </h2>
              <p className="text-xs text-slate-500">Test routing logic with sample request payload</p>
            </div>
            <button onClick={() => setIsSimulatorOpen(false)} className="p-1 hover:bg-slate-200 rounded-lg text-slate-500">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Select Workflow</label>
              <select
                value={simSelectedCode}
                onChange={e => setSimSelectedCode(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-purple-500 focus:outline-none"
              >
                {definitions.map(wf => (
                  <option key={wf.id} value={wf.code}>
                    {wf.name} ({wf.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Sample Request Payload (JSON)</label>
              <textarea
                rows={8}
                value={simPayloadJson}
                onChange={e => setSimPayloadJson(e.target.value)}
                className="w-full font-mono text-[11px] border rounded-lg p-3 bg-slate-950 text-emerald-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>

            <button
              onClick={handleRunSimulation}
              disabled={isSimulating}
              className="w-full py-2.5 px-4 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl transition shadow flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isSimulating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Execute Simulation
            </button>

            {/* Simulation Results Box */}
            {simResult && (
              <div className="pt-4 border-t space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-800 text-sm">Simulation Output</h3>
                  {simResult.autoApproved ? (
                    <span className="bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-full font-bold text-[10px]">
                      AUTO-APPROVED
                    </span>
                  ) : (
                    <span className="bg-purple-100 text-purple-800 px-2.5 py-0.5 rounded-full font-bold text-[10px]">
                      {simResult.activeStepCount} ACTIVE STEP(S)
                    </span>
                  )}
                </div>

                <div className="space-y-3">
                  {simResult.steps.map((st, i) => (
                    <div
                      key={i}
                      className={`p-3 rounded-xl border text-xs space-y-2 ${
                        st.conditionMet
                          ? 'bg-purple-50/50 border-purple-200'
                          : 'bg-slate-50 border-slate-200 opacity-60'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 flex items-center gap-1.5">
                          <span className="h-4 w-4 rounded-full bg-purple-600 text-white flex items-center justify-center text-[10px]">
                            {st.stepIndex + 1}
                          </span>
                          {st.name}
                        </span>
                        {st.conditionMet ? (
                          <span className="text-emerald-700 font-bold text-[11px] flex items-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5" /> Condition Met
                          </span>
                        ) : (
                          <span className="text-slate-400 font-medium text-[11px]">
                            Skipped
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] text-slate-600 space-y-0.5">
                        <p>Approver: <strong className="text-slate-800 capitalize">{st.approverType.replace('_', ' ')}</strong> {st.approverRole ? `(${st.approverRole})` : ''}</p>
                        {st.slaHours && <p>SLA Window: <strong>{st.slaHours} hours</strong></p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
