export type GeofenceStatus = 'inside' | 'borderline' | 'outside';

export interface GeofenceEvaluationResult {
  locationId: string;
  locationName: string;
  geofenceType: 'radius' | 'polygon';
  distanceMeters: number;
  radiusMeters: number;
  accuracyMeters: number;
  isInside: boolean;
  status: GeofenceStatus;
}

/**
 * Classifies location status based on PostGIS distance, radius, and device GPS accuracy.
 *
 * Ground Rules:
 * - INSIDE: Point is geometrically inside the radius or polygon boundary.
 * - BORDERLINE: Point is outside the defined boundary, but within the GPS accuracy uncertainty bubble (distance <= radius + accuracy).
 * - OUTSIDE: Point is strictly beyond the radius + accuracy threshold.
 */
export function classifyGeofenceStatus(
  isInside: boolean,
  distanceMeters: number,
  radiusMeters: number,
  accuracyMeters: number,
): GeofenceStatus {
  if (isInside || distanceMeters <= radiusMeters) {
    return 'inside';
  }

  if (distanceMeters <= radiusMeters + accuracyMeters) {
    return 'borderline';
  }

  return 'outside';
}

/**
 * Validates WGS84 Longitude and Latitude coordinates.
 * Prevents longitude/latitude inversion regressions.
 */
export function validateWgs84Coordinates(lon: number, lat: number): void {
  if (typeof lon !== 'number' || Number.isNaN(lon) || lon < -180 || lon > 180) {
    throw new Error(`Invalid longitude ${lon}. Must be between -180 and 180.`);
  }
  if (typeof lat !== 'number' || Number.isNaN(lat) || lat < -90 || lat > 90) {
    throw new Error(`Invalid latitude ${lat}. Must be between -90 and 90.`);
  }
}

/**
 * Haversine formula calculation in meters as a deterministic, pure CPU fallback.
 * Used for in-memory comparisons, unit tests, and validation without round-tripping to PostGIS.
 */
export function calculateHaversineDistanceMeters(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
  validateWgs84Coordinates(lon1, lat1);
  validateWgs84Coordinates(lon2, lat2);

  const R = 6371000; // Earth mean radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

/**
 * Point-in-polygon ray casting algorithm for 2D GeoJSON polygon rings: [ [lon, lat], ... ].
 */
export function isPointInPolygon(
  pointLon: number,
  pointLat: number,
  polygonRings: number[][][],
): boolean {
  validateWgs84Coordinates(pointLon, pointLat);
  if (!polygonRings || polygonRings.length === 0) return false;

  const exteriorRing = polygonRings[0];
  if (!exteriorRing || exteriorRing.length < 3) return false;

  let inside = false;
  for (let i = 0, j = exteriorRing.length - 1; i < exteriorRing.length; j = i++) {
    const xi = exteriorRing[i]![0]!;
    const yi = exteriorRing[i]![1]!;
    const xj = exteriorRing[j]![0]!;
    const yj = exteriorRing[j]![1]!;

    const intersect =
      yi > pointLat !== yj > pointLat &&
      pointLon < ((xj - xi) * (pointLat - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}
