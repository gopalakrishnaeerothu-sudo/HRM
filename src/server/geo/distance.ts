/**
 * Great-circle distance primitives.
 *
 * Pure functions with no I/O, so they are unit-testable in isolation and can
 * run on either side of the wire. The *authoritative* evaluation is always the
 * server's — see `src/server/geo/verify.ts`.
 *
 * Why Haversine rather than PostGIS: geofence radii here are tens to hundreds
 * of metres, where Haversine's spherical-Earth error (≤ 0.5%, i.e. ≤ 0.5 m at
 * 100 m) is an order of magnitude smaller than consumer GPS accuracy (5–50 m).
 * Keeping the maths in the application also means the check works on a stock
 * Railway Postgres image with no PostGIS extension. If sub-metre accuracy or
 * polygon geofences are ever needed, swap this module for a
 * `ST_DWithin(geography, geography, radius)` query — nothing else changes,
 * because every caller goes through `distanceMeters`.
 */

/** WGS-84 mean Earth radius, in metres. */
export const EARTH_RADIUS_METERS = 6_371_008.8;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** True when the pair is a real point on Earth (and not the 0,0 null island). */
export function isValidCoordinate(point: Coordinates): boolean {
  const { latitude, longitude } = point;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  // Exactly (0, 0) is almost always an uninitialised value, not a location in
  // the Gulf of Guinea. Rejecting it costs nothing and catches a real bug class.
  if (latitude === 0 && longitude === 0) return false;
  return true;
}

/**
 * Great-circle distance between two points, in metres.
 *
 * Uses the Haversine form, which stays numerically stable for the small
 * distances this product cares about (the law-of-cosines form loses precision
 * below a few metres).
 */
export function distanceMeters(from: Coordinates, to: Coordinates): number {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const deltaLat = toRadians(to.latitude - from.latitude);
  const deltaLon = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Whether `point` lies within `radiusMeters` of `centre`. */
export function isWithinRadius(
  point: Coordinates,
  centre: Coordinates,
  radiusMeters: number,
): boolean {
  return distanceMeters(point, centre) <= radiusMeters;
}

/**
 * Implied ground speed between two timestamped fixes, in km/h.
 *
 * Returns `Infinity` when the two fixes share a timestamp but differ in
 * position — a physical impossibility that the caller should treat as a
 * failed check rather than a division-by-zero.
 */
export function impliedSpeedKmh(
  from: Coordinates & { at: Date },
  to: Coordinates & { at: Date },
): number {
  const seconds = Math.abs(to.at.getTime() - from.at.getTime()) / 1000;
  const metres = distanceMeters(from, to);

  if (seconds === 0) return metres === 0 ? 0 : Number.POSITIVE_INFINITY;
  return (metres / seconds) * 3.6;
}

/**
 * Offset a point by a north/east displacement in metres.
 * Used to draw geofence previews and to generate demo coordinates.
 */
export function offsetByMeters(
  origin: Coordinates,
  northMeters: number,
  eastMeters: number,
): Coordinates {
  const deltaLat = (northMeters / EARTH_RADIUS_METERS) * (180 / Math.PI);
  const deltaLon =
    (eastMeters / (EARTH_RADIUS_METERS * Math.cos(toRadians(origin.latitude)))) * (180 / Math.PI);

  return {
    latitude: origin.latitude + deltaLat,
    longitude: origin.longitude + deltaLon,
  };
}

/** Degrees of latitude/longitude covering `meters`, for map bounding boxes. */
export function metersToDegrees(meters: number, atLatitude: number) {
  const latDegrees = (meters / EARTH_RADIUS_METERS) * (180 / Math.PI);
  const lonDegrees =
    (meters / (EARTH_RADIUS_METERS * Math.cos(toRadians(atLatitude)))) * (180 / Math.PI);
  return { latDegrees, lonDegrees };
}
