import { describe, it, expect } from 'vitest';
import {
  classifyGeofenceStatus,
  calculateHaversineDistanceMeters,
  isPointInPolygon,
  validateWgs84Coordinates,
} from './geofence.js';

describe('Sprint 2.1 PostGIS Geofence Evaluation Engine (P2-LOC-01 & P2-QA-01)', () => {
  // Bangalore Office Reference Coordinates: 77.5946° E, 12.9716° N (Cubbon Park)
  const bangaloreOffice = { lon: 77.5946, lat: 12.9716 };

  describe('Classification Rules: Inside, Borderline, Outside', () => {
    const radiusMeters = 100;
    const accuracyMeters = 20;

    it('classifies point inside when geometric isInside is true', () => {
      const status = classifyGeofenceStatus(true, 50, radiusMeters, accuracyMeters);
      expect(status).toBe('inside');
    });

    it('classifies point inside when distance <= radius even if isInside is false', () => {
      const status = classifyGeofenceStatus(false, 95, radiusMeters, accuracyMeters);
      expect(status).toBe('inside');
    });

    it('classifies point inside on exact radius boundary (distance === radius)', () => {
      const status = classifyGeofenceStatus(false, 100, radiusMeters, accuracyMeters);
      expect(status).toBe('inside');
    });

    it('classifies point as borderline when outside radius but within accuracy buffer (radius < distance <= radius + accuracy)', () => {
      // 100m radius + 20m accuracy => borderline up to 120m
      const statusAt110m = classifyGeofenceStatus(false, 110, radiusMeters, accuracyMeters);
      expect(statusAt110m).toBe('borderline');

      const statusAt120m = classifyGeofenceStatus(false, 120, radiusMeters, accuracyMeters);
      expect(statusAt120m).toBe('borderline');
    });

    it('classifies point as outside when strictly beyond radius + accuracy buffer', () => {
      const statusAt121m = classifyGeofenceStatus(false, 121, radiusMeters, accuracyMeters);
      expect(statusAt121m).toBe('outside');

      const statusAt500m = classifyGeofenceStatus(false, 500, radiusMeters, accuracyMeters);
      expect(statusAt500m).toBe('outside');
    });
  });

  describe('Coordinate Validation & Lon/Lat Inversion Regression', () => {
    it('accepts valid WGS84 longitude and latitude', () => {
      expect(() => validateWgs84Coordinates(77.5946, 12.9716)).not.toThrow();
      expect(() => validateWgs84Coordinates(-180, -90)).not.toThrow();
      expect(() => validateWgs84Coordinates(180, 90)).not.toThrow();
    });

    it('throws when longitude is out of range [-180, 180]', () => {
      expect(() => validateWgs84Coordinates(181, 12.9716)).toThrow(/Invalid longitude/);
      expect(() => validateWgs84Coordinates(-185, 12.9716)).toThrow(/Invalid longitude/);
    });

    it('throws when latitude is out of range [-90, 90]', () => {
      expect(() => validateWgs84Coordinates(77.5946, 95)).toThrow(/Invalid latitude/);
      expect(() => validateWgs84Coordinates(77.5946, -91)).toThrow(/Invalid latitude/);
    });

    it('detects inverted coordinates where lon was swapped with lat', () => {
      // If someone sends latitude as 120 (expecting longitude), it fails
      expect(() => validateWgs84Coordinates(12.9716, 120)).toThrow(/Invalid latitude 120/);
    });
  });

  describe('Haversine Distance Metric', () => {
    it('calculates zero distance for identical coordinates', () => {
      const dist = calculateHaversineDistanceMeters(
        bangaloreOffice.lon,
        bangaloreOffice.lat,
        bangaloreOffice.lon,
        bangaloreOffice.lat,
      );
      expect(dist).toBe(0);
    });

    it('calculates realistic distance between Bangalore and Electronic City (~16-17 km)', () => {
      const electronicCity = { lon: 77.6784, lat: 12.8399 };
      const dist = calculateHaversineDistanceMeters(
        bangaloreOffice.lon,
        bangaloreOffice.lat,
        electronicCity.lon,
        electronicCity.lat,
      );
      expect(dist).toBeGreaterThan(16000);
      expect(dist).toBeLessThan(18000);
    });

    it('calculates realistic distance between Delhi and Mumbai (~1140-1170 km)', () => {
      const delhi = { lon: 77.209, lat: 28.6139 };
      const mumbai = { lon: 72.8777, lat: 19.076 };
      const dist = calculateHaversineDistanceMeters(delhi.lon, delhi.lat, mumbai.lon, mumbai.lat);
      expect(dist).toBeGreaterThan(1140000);
      expect(dist).toBeLessThan(1180000);
    });
  });

  describe('Polygon Containment (2D Ray-Casting & GeoJSON Lon/Lat Format)', () => {
    // Square polygon in Bangalore: [lon, lat] order
    // Bounds: Lon 77.590 to 77.600, Lat 12.970 to 12.980
    const polygonGeoJson: number[][][] = [
      [
        [77.59, 12.97],
        [77.6, 12.97],
        [77.6, 12.98],
        [77.59, 12.98],
        [77.59, 12.97], // Closed ring
      ],
    ];

    it('detects point clearly inside polygon', () => {
      const insidePoint = { lon: 77.595, lat: 12.975 };
      expect(isPointInPolygon(insidePoint.lon, insidePoint.lat, polygonGeoJson)).toBe(true);
    });

    it('detects point clearly outside polygon', () => {
      const outsidePoint = { lon: 77.61, lat: 12.975 };
      expect(isPointInPolygon(outsidePoint.lon, outsidePoint.lat, polygonGeoJson)).toBe(false);
    });

    it('handles empty or degenerate polygon gracefully', () => {
      expect(isPointInPolygon(77.595, 12.975, [])).toBe(false);
      expect(isPointInPolygon(77.595, 12.975, [[[]]])).toBe(false);
    });
  });
});
