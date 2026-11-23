/** F1 – geo math. All distances in metres unless stated otherwise. */

export const EARTH_RADIUS_M = 6_371_008.8;

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Circle extends LatLng {
  radiusM: number;
}

export type MatchMode = 'lenient' | 'strict';

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance (haversine) in metres. */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Whether a fix lies inside a circle.
 * - lenient: centre of the fix is inside the circle
 * - strict: the whole accuracy circle is inside (certainly inside)
 */
export function isInside(fix: LatLng & { accuracy: number }, circle: Circle, mode: MatchMode): boolean {
  const d = haversineM(fix, circle);
  return mode === 'strict' ? d + Math.max(0, fix.accuracy) <= circle.radiusM : d <= circle.radiusM;
}

export type DistanceBand = '<200m' | '<500m' | '<1km' | '<5km' | '>5km';

export function distanceBand(distanceM: number): DistanceBand {
  if (distanceM < 200) return '<200m';
  if (distanceM < 500) return '<500m';
  if (distanceM < 1000) return '<1km';
  if (distanceM < 5000) return '<5km';
  return '>5km';
}

/** Round a coordinate to `decimals` places (3 ≈ 110 m) – used for privacy. */
export function roundCoord(value: number, decimals = 3): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
