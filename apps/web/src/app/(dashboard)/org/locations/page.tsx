'use client';

import React, { useEffect, useState } from 'react';
import {
  MapPin,
  Plus,
  Search,
  CheckCircle,
  XCircle,
  X,
  AlertCircle,
  Compass,
  Globe,
  Clock,
  Edit2,
  Trash2,
} from 'lucide-react';

interface LocationAddress {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  country: string;
  postalCode: string;
}

interface WorkLocation {
  id: string;
  name: string;
  code: string;
  address: LocationAddress;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number | null;
  active: boolean;
  createdAt: string;
}

export default function WorkLocationsPage() {
  const [locations, setLocations] = useState<WorkLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<WorkLocation | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [country, setCountry] = useState('India');
  const [postalCode, setPostalCode] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [latitude, setLatitude] = useState<string>('');
  const [longitude, setLongitude] = useState<string>('');
  const [radiusMeters, setRadiusMeters] = useState<string>('200');
  const [active, setActive] = useState(true);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadLocations = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/v1/org/locations');
      if (res.ok) {
        const json = await res.json();
        setLocations(json.data || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLocations();
  }, []);

  const openCreateDialog = () => {
    setEditingLocation(null);
    setName('');
    setCode('');
    setLine1('');
    setLine2('');
    setCity('');
    setState('');
    setCountry('India');
    setPostalCode('');
    setTimezone('Asia/Kolkata');
    setLatitude('');
    setLongitude('');
    setRadiusMeters('200');
    setActive(true);
    setFormError(null);
    setDialogOpen(true);
  };

  const openEditDialog = (loc: WorkLocation) => {
    setEditingLocation(loc);
    setName(loc.name);
    setCode(loc.code);
    setLine1(loc.address.line1 || '');
    setLine2(loc.address.line2 || '');
    setCity(loc.address.city || '');
    setState(loc.address.state || '');
    setCountry(loc.address.country || 'India');
    setPostalCode(loc.address.postalCode || '');
    setTimezone(loc.timezone || 'Asia/Kolkata');
    setLatitude(loc.latitude !== null ? String(loc.latitude) : '');
    setLongitude(loc.longitude !== null ? String(loc.longitude) : '');
    setRadiusMeters(loc.radiusMeters !== null ? String(loc.radiusMeters) : '');
    setActive(loc.active);
    setFormError(null);
    setDialogOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);

    const payload = {
      name,
      code,
      address: {
        line1,
        line2: line2 || null,
        city,
        state,
        country,
        postalCode,
      },
      timezone,
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
      radiusMeters: radiusMeters ? parseInt(radiusMeters, 10) : null,
      active,
    };

    try {
      const url = editingLocation
        ? `/api/v1/org/locations/${editingLocation.id}`
        : '/api/v1/org/locations';
      const method = editingLocation ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || err.message || 'Failed to save location.');
      }

      setDialogOpen(false);
      await loadLocations();
    } catch (err: unknown) {
      setFormError((err as Error).message || 'Failed to save location.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete "${name}"?`)) return;

    try {
      const res = await fetch(`/api/v1/org/locations/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        await loadLocations();
      } else {
        const err = await res.json();
        alert(err.error?.message || 'Failed to delete location.');
      }
    } catch {
      alert('Network error while deleting location.');
    }
  };

  const filtered = locations.filter(l =>
    l.name.toLowerCase().includes(search.toLowerCase()) ||
    l.code.toLowerCase().includes(search.toLowerCase()) ||
    l.address.city.toLowerCase().includes(search.toLowerCase()) ||
    l.address.state.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <MapPin className="h-7 w-7 text-primary" />
            Work Locations
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage company offices, remote hubs, and geofencing configurations for attendance validation.
          </p>
        </div>
        <button
          onClick={openCreateDialog}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Add Location
        </button>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-center bg-card p-4 rounded-xl border border-border shadow-sm">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by name, code, or city..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition"
          />
        </div>
        <div className="text-xs text-muted-foreground font-medium">
          Showing {filtered.length} of {locations.length} locations
        </div>
      </div>

      {/* Locations Table */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-muted-foreground animate-pulse">
            Loading work locations...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <MapPin className="mx-auto h-12 w-12 text-muted-foreground/40 mb-3" />
            <h3 className="text-base font-semibold text-foreground">No work locations found</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
              Get started by adding your company's offices, work hubs, or regional sites.
            </p>
            <button
              onClick={openCreateDialog}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition"
            >
              <Plus className="h-4 w-4" /> Add Work Location
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 border-b border-border text-xs uppercase text-muted-foreground font-semibold">
                <tr>
                  <th className="py-3.5 px-6">Location</th>
                  <th className="py-3.5 px-6">Address</th>
                  <th className="py-3.5 px-6">Timezone</th>
                  <th className="py-3.5 px-6">Geofence (PostGIS)</th>
                  <th className="py-3.5 px-6">Status</th>
                  <th className="py-3.5 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map(loc => (
                  <tr key={loc.id} className="hover:bg-muted/30 transition">
                    <td className="py-4 px-6">
                      <div className="font-semibold text-foreground">{loc.name}</div>
                      <div className="text-xs text-muted-foreground font-mono mt-0.5">
                        {loc.code}
                      </div>
                    </td>
                    <td className="py-4 px-6 max-w-xs">
                      <div className="text-foreground truncate">{loc.address.line1}</div>
                      <div className="text-xs text-muted-foreground">
                        {loc.address.city}, {loc.address.state} - {loc.address.postalCode}
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-muted text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {loc.timezone}
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      {loc.latitude !== null && loc.longitude !== null ? (
                        <div className="space-y-1">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                            <Compass className="h-3 w-3" />
                            {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                          </span>
                          <div className="text-[11px] text-muted-foreground">
                            Radius: {loc.radiusMeters || 100}m
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/60 italic">
                          No geofence set
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-6">
                      {loc.active ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                          <CheckCircle className="h-3 w-3" /> Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                          <XCircle className="h-3 w-3" /> Inactive
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => openEditDialog(loc)}
                          className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition"
                          title="Edit Location"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(loc.id, loc.name)}
                          className="p-1.5 text-destructive hover:bg-destructive/10 rounded-md transition"
                          title="Delete Location"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Dialog */}
      {dialogOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-2xl w-full max-w-xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary" />
                {editingLocation ? 'Edit Work Location' : 'New Work Location'}
              </h2>
              <button
                onClick={() => setDialogOpen(false)}
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="overflow-y-auto p-6 space-y-4">
              {formError && (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">
                    Location Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Bangalore Headquarters"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">
                    Location Code *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. BLR-HQ"
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none uppercase"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Address Line 1 *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Street address, building, suite"
                  value={line1}
                  onChange={e => setLine1(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-foreground mb-1">
                  Address Line 2
                </label>
                <input
                  type="text"
                  placeholder="Apartment, suite, unit, etc."
                  value={line2}
                  onChange={e => setLine2(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">City *</label>
                  <input
                    type="text"
                    required
                    placeholder="City"
                    value={city}
                    onChange={e => setCity(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">State *</label>
                  <input
                    type="text"
                    required
                    placeholder="State"
                    value={state}
                    onChange={e => setState(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">Postal Code *</label>
                  <input
                    type="text"
                    required
                    placeholder="PIN / Zip"
                    value={postalCode}
                    onChange={e => setPostalCode(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">Country *</label>
                  <input
                    type="text"
                    required
                    value={country}
                    onChange={e => setCountry(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-foreground mb-1">Timezone *</label>
                  <input
                    type="text"
                    required
                    value={timezone}
                    onChange={e => setTimezone(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none font-mono"
                  />
                </div>
              </div>

              {/* Geofence PostGIS Settings */}
              <div className="p-4 rounded-xl border border-border bg-muted/20 space-y-3">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-primary" />
                  <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                    Geofence & Coordinates (Optional)
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  PostGIS coordinates enable geofenced mobile check-ins and attendance perimeter validation.
                </p>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-foreground mb-1">
                      Latitude (-90 to 90)
                    </label>
                    <input
                      type="number"
                      step="any"
                      placeholder="e.g. 12.9716"
                      value={latitude}
                      onChange={e => setLatitude(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded border border-input bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-foreground mb-1">
                      Longitude (-180 to 180)
                    </label>
                    <input
                      type="number"
                      step="any"
                      placeholder="e.g. 77.5946"
                      value={longitude}
                      onChange={e => setLongitude(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded border border-input bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-foreground mb-1">
                      Radius (Meters)
                    </label>
                    <input
                      type="number"
                      placeholder="e.g. 200"
                      value={radiusMeters}
                      onChange={e => setRadiusMeters(e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded border border-input bg-background focus:ring-2 focus:ring-primary/20 outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="activeCheck"
                  checked={active}
                  onChange={e => setActive(e.target.checked)}
                  className="rounded border-input text-primary focus:ring-primary"
                />
                <label htmlFor="activeCheck" className="text-xs font-semibold text-foreground">
                  Active location (available for employee assignment)
                </label>
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
                  {saving ? 'Saving...' : editingLocation ? 'Update Location' : 'Create Location'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
