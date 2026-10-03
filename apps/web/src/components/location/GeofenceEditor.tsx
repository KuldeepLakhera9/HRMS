'use client';

import React, { useEffect, useRef, useState } from 'react';
import type * as L from 'leaflet';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Wifi,
  QrCode,
  Save,
  RotateCcw,
  Plus,
  Trash2,
  Crosshair,
  Clock,
} from 'lucide-react';

interface GeofenceEditorProps {
  locationId: string;
  initialData?: {
    name?: string;
    geofenceType?: 'radius' | 'polygon';
    radiusMeters?: number;
    center?: { longitude: number; latitude: number };
    polygonGeoJson?: {
      type: 'Polygon';
      coordinates: number[][][];
    } | null;
    wifiBssids?: string[];
    qrSecret?: string | null;
    geofenceVersion?: number;
    timezone?: string;
  };
}

interface TestResult {
  status: 'INSIDE' | 'BORDERLINE' | 'OUTSIDE';
  distanceMeters: number;
  thresholdMeters: number;
  evaluatedAt: string;
}

export default function GeofenceEditor({ locationId, initialData }: GeofenceEditorProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const circleLayerRef = useRef<L.Circle | null>(null);
  const polygonLayerRef = useRef<L.Polygon | null>(null);
  const centerMarkerRef = useRef<L.Marker | null>(null);
  const testMarkerRef = useRef<L.Marker | null>(null);

  const [geofenceType, setGeofenceType] = useState<'radius' | 'polygon'>(
    initialData?.geofenceType ?? 'radius',
  );
  const [centerLat, setCenterLat] = useState<number>(initialData?.center?.latitude ?? 12.9716);
  const [centerLng, setCenterLng] = useState<number>(initialData?.center?.longitude ?? 77.5946);
  const [radiusMeters, setRadiusMeters] = useState<number>(initialData?.radiusMeters ?? 100);
  const [polygonCoords, setPolygonCoords] = useState<[number, number][]>(
    initialData?.polygonGeoJson?.coordinates[0]?.map(c => [c[1], c[0]] as [number, number]) ?? [],
  );
  const [wifiBssids, setWifiBssids] = useState<string[]>(initialData?.wifiBssids ?? []);
  const [newBssid, setNewBssid] = useState('');
  const [qrSecret, setQrSecret] = useState<string | null>(initialData?.qrSecret ?? null);
  const [timezone, setTimezone] = useState<string>(initialData?.timezone ?? 'Asia/Kolkata');
  const [version, setVersion] = useState<number>(initialData?.geofenceVersion ?? 1);

  // Testing coordinates state
  const [testLat, setTestLat] = useState<string>('');
  const [testLng, setTestLng] = useState<string>('');
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Initialize Leaflet Map on Client Mount
  useEffect(() => {
    let isMounted = true;

    async function initMap() {
      if (!mapContainerRef.current || mapInstanceRef.current) return;

      const leaflet = await import('leaflet');

      // Inject Leaflet CSS link if not already present
      if (!document.getElementById('leaflet-css')) {
        const link = document.createElement('link');
        link.id = 'leaflet-css';
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }

      if (!isMounted) return;

      const map = leaflet.map(mapContainerRef.current).setView([centerLat, centerLng], 16);
      mapInstanceRef.current = map;

      const tileUrl =
        process.env.NEXT_PUBLIC_MAP_TILE_URL ||
        'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

      leaflet
        .tileLayer(tileUrl, {
          maxZoom: 19,
          attribution: '© OpenStreetMap contributors',
        })
        .addTo(map);

      // Center Marker
      const centerIcon = leaflet.divIcon({
        className: 'custom-center-marker',
        html: `<div style="background-color:#2563eb; width:16px; height:16px; border-radius:50%; border:3px solid white; box-shadow:0 0 8px rgba(0,0,0,0.5);"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });

      const marker = leaflet
        .marker([centerLat, centerLng], { icon: centerIcon, draggable: true })
        .addTo(map);
      centerMarkerRef.current = marker;

      marker.on('dragend', () => {
        const pos = marker.getLatLng();
        setCenterLat(Number(pos.lat.toFixed(6)));
        setCenterLng(Number(pos.lng.toFixed(6)));
      });

      // Map Click Handler for Testing Coordinates or Polygon creation
      map.on('click', (e: L.LeafletMouseEvent) => {
        const lat = Number(e.latlng.lat.toFixed(6));
        const lng = Number(e.latlng.lng.toFixed(6));
        setTestLat(lat.toString());
        setTestLng(lng.toString());
      });
    }

    initMap();

    return () => {
      isMounted = false;
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Update Map Center Marker and View
  useEffect(() => {
    if (!mapInstanceRef.current || !centerMarkerRef.current) return;
    centerMarkerRef.current.setLatLng([centerLat, centerLng]);
  }, [centerLat, centerLng]);

  // Update Radius Layer
  useEffect(() => {
    async function updateRadius() {
      if (!mapInstanceRef.current) return;
      const leaflet = await import('leaflet');

      if (geofenceType === 'radius') {
        if (polygonLayerRef.current) {
          polygonLayerRef.current.remove();
          polygonLayerRef.current = null;
        }

        if (!circleLayerRef.current) {
          circleLayerRef.current = leaflet
            .circle([centerLat, centerLng], {
              radius: radiusMeters,
              color: '#3b82f6',
              fillColor: '#60a5fa',
              fillOpacity: 0.25,
              weight: 2,
            })
            .addTo(mapInstanceRef.current);
        } else {
          circleLayerRef.current.setLatLng([centerLat, centerLng]);
          circleLayerRef.current.setRadius(radiusMeters);
        }
      } else {
        if (circleLayerRef.current) {
          circleLayerRef.current.remove();
          circleLayerRef.current = null;
        }
      }
    }
    updateRadius();
  }, [geofenceType, centerLat, centerLng, radiusMeters]);

  // Update Polygon Layer
  useEffect(() => {
    async function updatePolygon() {
      if (!mapInstanceRef.current) return;
      const leaflet = await import('leaflet');

      if (geofenceType === 'polygon' && polygonCoords.length >= 3) {
        if (!polygonLayerRef.current) {
          polygonLayerRef.current = leaflet
            .polygon(polygonCoords, {
              color: '#10b981',
              fillColor: '#34d399',
              fillOpacity: 0.25,
              weight: 2,
            })
            .addTo(mapInstanceRef.current);
        } else {
          polygonLayerRef.current.setLatLngs(polygonCoords);
        }
      } else if (polygonLayerRef.current) {
        polygonLayerRef.current.remove();
        polygonLayerRef.current = null;
      }
    }
    updatePolygon();
  }, [geofenceType, polygonCoords]);

  // Handle Testing Coordinate
  const handleTestCoordinate = async () => {
    const lat = parseFloat(testLat);
    const lng = parseFloat(testLng);

    if (isNaN(lat) || isNaN(lng)) {
      alert('Please enter valid latitude and longitude coordinates.');
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const res = await fetch(`/api/v1/org/locations/${locationId}/test-coordinate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude: lat, longitude: lng }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'Failed to evaluate coordinate');
      }

      const json = await res.json();
      setTestResult(json.data);

      // Place or update Test Pin on Map
      if (mapInstanceRef.current) {
        const leaflet = await import('leaflet');
        const color =
          json.data.status === 'INSIDE'
            ? '#16a34a'
            : json.data.status === 'BORDERLINE'
              ? '#f59e0b'
              : '#dc2626';

        const testIcon = leaflet.divIcon({
          className: 'custom-test-marker',
          html: `<div style="background-color:${color}; width:18px; height:18px; border-radius:50%; border:3px solid white; box-shadow:0 0 10px rgba(0,0,0,0.6);"></div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });

        if (testMarkerRef.current) {
          testMarkerRef.current.setLatLng([lat, lng]);
          testMarkerRef.current.setIcon(testIcon);
        } else {
          testMarkerRef.current = leaflet
            .marker([lat, lng], { icon: testIcon })
            .addTo(mapInstanceRef.current);
        }
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Evaluation failed');
    } finally {
      setIsTesting(false);
    }
  };

  // Add BSSID
  const handleAddBssid = () => {
    const formatted = newBssid.trim().toUpperCase();
    if (!formatted) return;
    if (!/^([0-9A-F]{2}[:-]){5}([0-9A-F]{2})$/.test(formatted)) {
      alert('Invalid BSSID format. Expected format: AA:BB:CC:DD:EE:FF');
      return;
    }
    if (!wifiBssids.includes(formatted)) {
      setWifiBssids([...wifiBssids, formatted]);
    }
    setNewBssid('');
  };

  // Remove BSSID
  const handleRemoveBssid = (bssid: string) => {
    setWifiBssids(wifiBssids.filter(b => b !== bssid));
  };

  // Regenerate QR Secret
  const handleRegenerateQr = () => {
    const randomSecret = 'qr_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    setQrSecret(randomSecret);
  };

  // Add current map center or test coordinate to polygon
  const handleAddPolygonPoint = () => {
    const lat = parseFloat(testLat) || centerLat;
    const lng = parseFloat(testLng) || centerLng;
    setPolygonCoords([...polygonCoords, [lat, lng]]);
  };

  // Save Geofence
  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);

    try {
      const payload: Record<string, unknown> = {
        geofenceType,
        center: { longitude: centerLng, latitude: centerLat },
        wifiBssids,
        qrSecret,
        timezone,
      };

      if (geofenceType === 'radius') {
        payload.radiusMeters = radiusMeters;
        payload.polygonGeoJson = null;
      } else {
        if (polygonCoords.length < 3) {
          throw new Error('A polygon geofence requires at least 3 points.');
        }
        // Ensure closed ring [lng, lat]
        const ring = polygonCoords.map(p => [p[1], p[0]]);
        if (
          ring[0][0] !== ring[ring.length - 1][0] ||
          ring[0][1] !== ring[ring.length - 1][1]
        ) {
          ring.push([ring[0][0], ring[0][1]]);
        }
        payload.polygonGeoJson = {
          type: 'Polygon',
          coordinates: [ring],
        };
      }

      const res = await fetch(`/api/v1/org/locations/${locationId}/geofence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || 'Failed to save geofence configuration');
      }

      const json = await res.json();
      setVersion(json.data.geofenceVersion);
      setSaveMessage('Geofence configuration saved successfully!');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Top Header / Meta Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Work Location Geofence & Boundary
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Configure PostGIS spatial boundaries, WiFi BSSIDs, and QR codes for employee punches.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-750 dark:bg-slate-800 dark:text-slate-300">
            Version: v{version}
          </span>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {isSaving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>

      {saveMessage && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          {saveMessage}
        </div>
      )}

      {/* Main Grid: Map + Controls */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Leaflet Map (2 Cols) */}
        <div className="relative min-h-[500px] overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm lg:col-span-2 dark:border-slate-800 dark:bg-slate-900">
          <div ref={mapContainerRef} className="h-full w-full min-h-[500px]" />

          {/* Quick Helper Floating Overlay */}
          <div className="absolute bottom-3 left-3 z-[1000] rounded-lg bg-white/95 px-3 py-2 text-xs font-medium text-slate-750 shadow backdrop-blur dark:bg-slate-900/95 dark:text-slate-300">
            💡 Tip: Click anywhere on the map to test coordinates or add polygon points. Drag the blue marker to adjust center.
          </div>
        </div>

        {/* Sidebar Settings Panel (1 Col) */}
        <div className="flex flex-col gap-6">
          {/* Mode Selector */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <label className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Boundary Type
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setGeofenceType('radius')}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                  geofenceType === 'radius'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                Circular Radius
              </button>
              <button
                type="button"
                onClick={() => setGeofenceType('polygon')}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                  geofenceType === 'polygon'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                Polygon Boundary
              </button>
            </div>

            {/* Radius Slider / Polygon Points */}
            {geofenceType === 'radius' ? (
              <div className="mt-4 flex flex-col gap-2">
                <div className="flex justify-between text-sm">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Radius</span>
                  <span className="font-bold text-blue-600">{radiusMeters} meters</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="1000"
                  step="10"
                  value={radiusMeters}
                  onChange={e => setRadiusMeters(Number(e.target.value))}
                  className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 dark:bg-slate-700"
                />
              </div>
            ) : (
              <div className="mt-4 flex flex-col gap-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Polygon Vertices ({polygonCoords.length})
                  </span>
                  <button
                    type="button"
                    onClick={handleAddPolygonPoint}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-500"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Point
                  </button>
                </div>
                {polygonCoords.length === 0 ? (
                  <p className="text-xs text-slate-400">Click on the map and click &apos;Add Point&apos; to draw polygon.</p>
                ) : (
                  <div className="max-h-28 overflow-y-auto divide-y divide-slate-100 text-xs dark:divide-slate-800">
                    {polygonCoords.map((coord, idx) => (
                      <div key={idx} className="flex items-center justify-between py-1">
                        <span>P{idx + 1}: {coord[0].toFixed(5)}, {coord[1].toFixed(5)}</span>
                        <button
                          type="button"
                          onClick={() => setPolygonCoords(polygonCoords.filter((_, i) => i !== idx))}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Center Coordinate Inputs */}
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div>
                <label className="font-medium text-slate-600 dark:text-slate-400">Latitude</label>
                <input
                  type="number"
                  step="any"
                  value={centerLat}
                  onChange={e => setCenterLat(parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full rounded-md border border-slate-300 p-1.5 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="font-medium text-slate-600 dark:text-slate-400">Longitude</label>
                <input
                  type="number"
                  step="any"
                  value={centerLng}
                  onChange={e => setCenterLng(parseFloat(e.target.value) || 0)}
                  className="mt-1 w-full rounded-md border border-slate-300 p-1.5 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
            </div>
          </div>

          {/* Test Coordinate Live Evaluation */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2">
              <Crosshair className="h-4 w-4 text-blue-600" />
              <label className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Test a Coordinate
              </label>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Simulate employee GPS location to test geofence enforcement.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <input
                type="text"
                placeholder="Latitude"
                value={testLat}
                onChange={e => setTestLat(e.target.value)}
                className="rounded-md border border-slate-300 p-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
              />
              <input
                type="text"
                placeholder="Longitude"
                value={testLng}
                onChange={e => setTestLng(e.target.value)}
                className="rounded-md border border-slate-300 p-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
              />
            </div>
            <button
              type="button"
              onClick={handleTestCoordinate}
              disabled={isTesting}
              className="mt-2 w-full rounded-lg bg-slate-900 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900"
            >
              {isTesting ? 'Evaluating PostGIS...' : 'Test Location'}
            </button>

            {testResult && (
              <div
                className={`mt-3 flex items-start gap-2 rounded-lg p-2.5 text-xs font-medium ${
                  testResult.status === 'INSIDE'
                    ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                    : testResult.status === 'BORDERLINE'
                      ? 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
                      : 'bg-rose-50 text-rose-900 dark:bg-rose-950 dark:text-rose-200'
                }`}
              >
                {testResult.status === 'INSIDE' && <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />}
                {testResult.status === 'BORDERLINE' && <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />}
                {testResult.status === 'OUTSIDE' && <XCircle className="h-4 w-4 text-rose-600 mt-0.5 shrink-0" />}
                <div>
                  <div className="font-bold tracking-wide">STATUS: {testResult.status}</div>
                  <div className="text-[11px] opacity-90">
                    Distance: {testResult.distanceMeters.toFixed(1)}m (Threshold: {testResult.thresholdMeters}m)
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Office WiFi BSSIDs */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2">
              <Wifi className="h-4 w-4 text-blue-600" />
              <label className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Authorized WiFi BSSIDs
              </label>
            </div>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                placeholder="AA:BB:CC:DD:EE:FF"
                value={newBssid}
                onChange={e => setNewBssid(e.target.value)}
                className="flex-1 rounded-md border border-slate-300 p-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
              />
              <button
                type="button"
                onClick={handleAddBssid}
                className="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
              >
                Add
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {wifiBssids.map(b => (
                <span
                  key={b}
                  className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-750 dark:bg-slate-800 dark:text-slate-300"
                >
                  {b}
                  <button type="button" onClick={() => handleRemoveBssid(b)} className="text-slate-400 hover:text-red-500">
                    &times;
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* QR Secret */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <QrCode className="h-4 w-4 text-blue-600" />
                <label className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Location QR Secret
                </label>
              </div>
              <button
                type="button"
                onClick={handleRegenerateQr}
                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-500"
              >
                <RotateCcw className="h-3 w-3" /> Regenerate
              </button>
            </div>
            <div className="mt-2 rounded bg-slate-50 p-2 font-mono text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {qrSecret || 'No QR secret generated yet.'}
            </div>
          </div>

          {/* Timezone */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-blue-600" />
              <label className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Location Timezone
              </label>
            </div>
            <select
              value={timezone}
              onChange={e => setTimezone(e.target.value)}
              className="mt-2 w-full rounded-md border border-slate-300 p-1.5 text-xs dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="Asia/Kolkata">Asia/Kolkata (IST +05:30)</option>
              <option value="UTC">UTC (+00:00)</option>
              <option value="America/New_York">America/New_York (EST/EDT)</option>
              <option value="Europe/London">Europe/London (GMT/BST)</option>
              <option value="Asia/Dubai">Asia/Dubai (GST +04:00)</option>
              <option value="Asia/Singapore">Asia/Singapore (SGT +08:00)</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
