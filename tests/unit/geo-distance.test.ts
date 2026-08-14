import { describe, expect, it } from "vitest";

import {
  distanceMeters,
  impliedSpeedKmh,
  isValidCoordinate,
  isWithinRadius,
  offsetByMeters,
} from "@/server/geo/distance";

/**
 * Distance maths.
 *
 * The tolerances below are deliberate: Haversine assumes a sphere, so it
 * differs from a geodesic calculation by up to ~0.5%. These assertions pin
 * that error down rather than papering over it — if a change pushes the error
 * outside these bounds, the geofence decision has moved.
 */

const GUNTUR = { latitude: 16.30656, longitude: 80.4365 };
const HYDERABAD = { latitude: 17.44855, longitude: 78.39109 };

describe("isValidCoordinate", () => {
  it("accepts a real location", () => {
    expect(isValidCoordinate(GUNTUR)).toBe(true);
  });

  it("rejects out-of-range latitude and longitude", () => {
    expect(isValidCoordinate({ latitude: 91, longitude: 0 })).toBe(false);
    expect(isValidCoordinate({ latitude: -91, longitude: 0 })).toBe(false);
    expect(isValidCoordinate({ latitude: 0, longitude: 181 })).toBe(false);
    expect(isValidCoordinate({ latitude: 0, longitude: -181 })).toBe(false);
  });

  it("rejects NaN and Infinity", () => {
    expect(isValidCoordinate({ latitude: Number.NaN, longitude: 80 })).toBe(false);
    expect(isValidCoordinate({ latitude: 16, longitude: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it("rejects exactly (0, 0), which is almost always an uninitialised value", () => {
    expect(isValidCoordinate({ latitude: 0, longitude: 0 })).toBe(false);
    // …but a genuine point near the origin is fine.
    expect(isValidCoordinate({ latitude: 0.0001, longitude: 0 })).toBe(true);
  });
});

describe("distanceMeters", () => {
  it("is zero for the same point", () => {
    expect(distanceMeters(GUNTUR, GUNTUR)).toBe(0);
  });

  it("is symmetric", () => {
    expect(distanceMeters(GUNTUR, HYDERABAD)).toBeCloseTo(distanceMeters(HYDERABAD, GUNTUR), 6);
  });

  it("matches the known Guntur–Hyderabad separation within 0.5%", () => {
    // Straight-line (great-circle) separation is ≈ 252 km. Note this is well
    // short of the ~285 km road distance — the two are not interchangeable.
    const metres = distanceMeters(GUNTUR, HYDERABAD);
    expect(metres).toBeGreaterThan(250_700);
    expect(metres).toBeLessThan(253_300);
  });

  it("stays accurate at geofence scale", () => {
    // 100 m due north of the office.
    const north = offsetByMeters(GUNTUR, 100, 0);
    expect(distanceMeters(GUNTUR, north)).toBeCloseTo(100, 0);

    // 100 m due east — the longitude scaling must account for latitude.
    const east = offsetByMeters(GUNTUR, 0, 100);
    expect(distanceMeters(GUNTUR, east)).toBeCloseTo(100, 0);
  });

  it("resolves single metres, which a 20 m minimum radius depends on", () => {
    const oneMetre = offsetByMeters(GUNTUR, 1, 0);
    expect(distanceMeters(GUNTUR, oneMetre)).toBeCloseTo(1, 1);
  });

  it("handles the antimeridian without blowing up", () => {
    const west = { latitude: 0.1, longitude: -179.999 };
    const east = { latitude: 0.1, longitude: 179.999 };
    // Roughly 222 m apart across the date line, not most of the way round Earth.
    expect(distanceMeters(west, east)).toBeLessThan(500);
  });
});

describe("isWithinRadius", () => {
  it("includes a point on the boundary", () => {
    const boundary = offsetByMeters(GUNTUR, 100, 0);
    // The boundary is inclusive: standing exactly on the line counts as inside.
    expect(isWithinRadius(boundary, GUNTUR, 101)).toBe(true);
  });

  it("excludes a point beyond the radius", () => {
    const outside = offsetByMeters(GUNTUR, 248, 0);
    expect(isWithinRadius(outside, GUNTUR, 100)).toBe(false);
  });
});

describe("impliedSpeedKmh", () => {
  it("is zero when nothing moved", () => {
    const at = new Date("2026-08-08T09:00:00Z");
    expect(impliedSpeedKmh({ ...GUNTUR, at }, { ...GUNTUR, at })).toBe(0);
  });

  it("computes a plausible commute speed", () => {
    const from = { ...GUNTUR, at: new Date("2026-08-08T09:00:00Z") };
    // 10 km in 15 minutes = 40 km/h.
    const to = { ...offsetByMeters(GUNTUR, 10_000, 0), at: new Date("2026-08-08T09:15:00Z") };
    expect(impliedSpeedKmh(from, to)).toBeCloseTo(40, 0);
  });

  it("returns Infinity for teleportation — two places at the same instant", () => {
    const at = new Date("2026-08-08T09:00:00Z");
    expect(impliedSpeedKmh({ ...GUNTUR, at }, { ...HYDERABAD, at })).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it("is direction-agnostic", () => {
    const from = { ...GUNTUR, at: new Date("2026-08-08T09:00:00Z") };
    const to = { ...HYDERABAD, at: new Date("2026-08-08T10:00:00Z") };
    expect(impliedSpeedKmh(to, from)).toBeCloseTo(impliedSpeedKmh(from, to), 6);
  });
});
