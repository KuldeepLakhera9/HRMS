'use client';

import React, { useEffect, useState } from 'react';
import {
  Layers,
  Plus,
  Trash2,
  AlertCircle,
  CheckCircle,
  RefreshCw,
} from 'lucide-react';

interface CustomFieldDef {
  id: string;
  entity: 'employee' | 'department' | 'location';
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'boolean' | 'json';
  required: boolean;
  options: string[] | { label: string; value: string }[];
  section: string;
  sortOrder: number;
}

export default function CustomFieldsBuilderPage() {
  const [activeTab, setActiveTab] = useState<'employee' | 'department' | 'location'>('employee');
  const [fields, setFields] = useState<CustomFieldDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form states
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newType, setNewType] = useState<'text' | 'number' | 'date' | 'select' | 'boolean' | 'json'>('text');
  const [newRequired, setNewRequired] = useState(false);
  const [newSection, setNewSection] = useState('general');
  const [newSortOrder, setNewSortOrder] = useState(0);
  const [newOptionsText, setNewOptionsText] = useState('');

  const loadFields = async (entity: 'employee' | 'department' | 'location') => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/custom-fields?entity=${entity}`);
      if (res.ok) {
        const json = await res.json();
        setFields(json.data || []);
      }
    } catch {
      setMessage({ type: 'error', text: 'Failed to load custom fields.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFields(activeTab);
  }, [activeTab]);

  const handleCreateField = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    const options = newType === 'select'
      ? newOptionsText.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    try {
      const res = await fetch('/api/v1/custom-fields', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity: activeTab,
          key: newKey.trim(),
          label: newLabel.trim(),
          type: newType,
          required: newRequired,
          section: newSection.trim() || 'general',
          sortOrder: Number(newSortOrder) || 0,
          options,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error?.message || 'Failed to create custom field');
      }

      setMessage({ type: 'success', text: `Field '${newLabel}' created successfully!` });
      setShowModal(false);
      // Reset form
      setNewKey('');
      setNewLabel('');
      setNewType('text');
      setNewRequired(false);
      setNewSection('general');
      setNewSortOrder(0);
      setNewOptionsText('');

      loadFields(activeTab);
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteField = async (id: string, label: string) => {
    if (!confirm(`Are you sure you want to delete custom field '${label}'?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/v1/custom-fields/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error?.message || 'Failed to delete custom field');
      }

      setMessage({ type: 'success', text: `Field '${label}' deleted.` });
      setFields(prev => prev.filter(f => f.id !== id));
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
            <span style={{ fontSize: '0.8125rem', color: '#818cf8', fontWeight: 600 }}>ADMINISTRATION</span>
          </div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            Custom Fields Builder
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Define extensible schema attributes for employees, departments, and locations with dynamic Zod validation.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="btn btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <Plus size={16} />
          <span>New Custom Field</span>
        </button>
      </div>

      {message && (
        <div
          style={{
            padding: '1rem',
            backgroundColor: message.type === 'success' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            border: `1px solid ${message.type === 'success' ? 'var(--success)' : 'var(--danger)'}`,
            borderRadius: '8px',
            color: message.type === 'success' ? 'var(--success)' : 'var(--danger)',
            marginBottom: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
          {message.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span>{message.text}</span>
        </div>
      )}

      {/* Entity Selector Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          borderBottom: '1px solid var(--border-color)',
          marginBottom: '1.5rem',
        }}
      >
        {(['employee', 'department', 'location'] as const).map(entity => (
          <button
            key={entity}
            type="button"
            onClick={() => setActiveTab(entity)}
            style={{
              padding: '0.75rem 1.25rem',
              fontWeight: 600,
              fontSize: '0.875rem',
              color: activeTab === entity ? '#fff' : 'var(--text-muted)',
              borderBottom: activeTab === entity ? '2px solid var(--primary)' : '2px solid transparent',
              background: 'none',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {entity} Fields
          </button>
        ))}
      </div>

      {/* Fields Table */}
      <div className="glass-panel" style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', textTransform: 'capitalize' }}>
            {activeTab} Attribute Definitions ({fields.length})
          </h2>
          <button
            type="button"
            onClick={() => loadFields(activeTab)}
            className="btn btn-secondary"
            style={{ padding: '0.4rem 0.75rem', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
          >
            <RefreshCw size={12} />
            <span>Refresh</span>
          </button>
        </div>

        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading field definitions...
          </div>
        ) : fields.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center' }}>
            <Layers size={36} color="var(--text-muted)" style={{ margin: '0 auto 1rem auto' }} />
            <div style={{ color: '#fff', fontWeight: 600, marginBottom: '0.25rem' }}>
              No custom fields configured for {activeTab}s yet
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
              Click &quot;New Custom Field&quot; to define extensible attributes.
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.875rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--text-muted)', textAlign: 'left', borderBottom: '1px solid var(--border-color)' }}>
                  <th style={{ padding: '0.75rem' }}>Label</th>
                  <th style={{ padding: '0.75rem' }}>Attribute Key</th>
                  <th style={{ padding: '0.75rem' }}>Data Type</th>
                  <th style={{ padding: '0.75rem' }}>Required</th>
                  <th style={{ padding: '0.75rem' }}>Section</th>
                  <th style={{ padding: '0.75rem' }}>Sort Order</th>
                  <th style={{ padding: '0.75rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {fields.map(field => (
                  <tr key={field.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 600, color: '#fff' }}>{field.label}</td>
                    <td style={{ padding: '0.75rem', fontFamily: 'monospace', color: '#818cf8' }}>{field.key}</td>
                    <td style={{ padding: '0.75rem' }}>
                      <span
                        style={{
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          backgroundColor: 'rgba(99, 102, 241, 0.15)',
                          color: 'var(--primary)',
                        }}
                      >
                        {field.type}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem' }}>
                      <span
                        style={{
                          padding: '0.2rem 0.5rem',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          backgroundColor: field.required ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                          color: field.required ? 'var(--danger)' : 'var(--text-muted)',
                        }}
                      >
                        {field.required ? 'YES' : 'NO'}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-secondary)' }}>{field.section}</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-muted)' }}>{field.sortOrder}</td>
                    <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                      <button
                        type="button"
                        onClick={() => handleDeleteField(field.id, field.label)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--danger)',
                          cursor: 'pointer',
                          padding: '0.25rem',
                        }}
                        title="Delete custom field"
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Custom Field Modal */}
      {showModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 999,
            padding: '1rem',
          }}
        >
          <div
            className="glass-panel"
            style={{
              width: '100%',
              maxWidth: '540px',
              padding: '2rem',
              borderRadius: '12px',
              backgroundColor: '#0f172a',
              border: '1px solid var(--border-color)',
            }}
          >
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fff', marginBottom: '0.5rem' }}>
              Add Custom Field ({activeTab})
            </h2>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
              Extends the schema with validated custom attributes stored in JSONB.
            </p>

            <form onSubmit={handleCreateField}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                    Field Key *
                  </label>
                  <input
                    type="text"
                    required
                    value={newKey}
                    onChange={e => setNewKey(e.target.value)}
                    placeholder="e.g. badge_number"
                    style={{
                      width: '100%',
                      padding: '0.625rem',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(30, 41, 59, 0.6)',
                      border: '1px solid var(--border-color)',
                      color: '#fff',
                      fontSize: '0.875rem',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                    Label Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={newLabel}
                    onChange={e => setNewLabel(e.target.value)}
                    placeholder="e.g. Badge Number"
                    style={{
                      width: '100%',
                      padding: '0.625rem',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(30, 41, 59, 0.6)',
                      border: '1px solid var(--border-color)',
                      color: '#fff',
                      fontSize: '0.875rem',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                    Data Type *
                  </label>
                  <select
                    value={newType}
                    onChange={e => setNewType(e.target.value as unknown as typeof newType)}
                    style={{
                      width: '100%',
                      padding: '0.625rem',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(30, 41, 59, 0.6)',
                      border: '1px solid var(--border-color)',
                      color: '#fff',
                      fontSize: '0.875rem',
                    }}
                  >
                    <option value="text">Text (string)</option>
                    <option value="number">Number (float/int)</option>
                    <option value="date">Date (YYYY-MM-DD)</option>
                    <option value="select">Dropdown Select</option>
                    <option value="boolean">Boolean (Yes/No)</option>
                    <option value="json">JSON Object</option>
                  </select>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                    Section Group
                  </label>
                  <input
                    type="text"
                    value={newSection}
                    onChange={e => setNewSection(e.target.value)}
                    placeholder="e.g. general, personal, job"
                    style={{
                      width: '100%',
                      padding: '0.625rem',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(30, 41, 59, 0.6)',
                      border: '1px solid var(--border-color)',
                      color: '#fff',
                      fontSize: '0.875rem',
                    }}
                  />
                </div>
              </div>

              {newType === 'select' && (
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
                    Options (comma-separated) *
                  </label>
                  <input
                    type="text"
                    value={newOptionsText}
                    onChange={e => setNewOptionsText(e.target.value)}
                    placeholder="e.g. Option A, Option B, Option C"
                    style={{
                      width: '100%',
                      padding: '0.625rem',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(30, 41, 59, 0.6)',
                      border: '1px solid var(--border-color)',
                      color: '#fff',
                      fontSize: '0.875rem',
                    }}
                  />
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '1.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.875rem', color: '#fff' }}>
                  <input
                    type="checkbox"
                    checked={newRequired}
                    onChange={e => setNewRequired(e.target.checked)}
                  />
                  <span>Required field</span>
                </label>

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <label style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>Sort Order:</label>
                  <input
                    type="number"
                    value={newSortOrder}
                    onChange={e => setNewSortOrder(Number(e.target.value))}
                    style={{
                      width: '60px',
                      padding: '0.4rem',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(30, 41, 59, 0.6)',
                      border: '1px solid var(--border-color)',
                      color: '#fff',
                      fontSize: '0.875rem',
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn btn-secondary"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn btn-primary"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                  {saving && <RefreshCw size={14} className="animate-spin" />}
                  <span>{saving ? 'Saving Definition...' : 'Save Definition'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
