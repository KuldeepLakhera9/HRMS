'use client';

import React, { use } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowLeft, MapPin } from 'lucide-react';

const DynamicGeofenceEditor = dynamic(
  () => import('@/components/location/GeofenceEditor'),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[550px] w-full items-center justify-center rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          <span className="text-sm font-medium text-slate-500">Loading Map Editor & Geofence Tools...</span>
        </div>
      </div>
    ),
  },
);

export default function GeofencePage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const locationId = resolvedParams.id;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 p-6">
      {/* Breadcrumb Navigation */}
      <nav className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <Link href="/org/locations" className="flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-slate-100">
          <ArrowLeft className="h-4 w-4" />
          Back to Work Locations
        </Link>
        <span>/</span>
        <span className="flex items-center gap-1 font-medium text-slate-900 dark:text-slate-100">
          <MapPin className="h-4 w-4 text-blue-600" />
          Geofence Boundary Configuration
        </span>
      </nav>

      {/* Dynamic Client Geofence Editor */}
      <DynamicGeofenceEditor locationId={locationId} />
    </div>
  );
}
