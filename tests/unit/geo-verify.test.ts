import { describe, expect, it } from "vitest";

import { offsetByMeters } from "@/server/geo/distance";
import { DEFAULT_POLICY, verifyLocation, type GeofenceZone } from "@/server/geo/verify";

/**
 * Geofence verification.
 *
 * These are the rules that decide whether someone's attendance is recorded, so
 * they are tested exhaustively — including the cases where a check *fails
 * open* (flagged but allowed) versus *fails closed* (refused), because getting
 * that distinction wrong is the difference between an annoyance and a hole.
 */

const OFFICE = { latitude: 16.30656, longitude: 80.4365 };
const NOW = new Date("2026-08-08T09:14:00Z");

const ZONE: GeofenceZone = {
  id: "zone-1",
  officeId: "office-1",
  officeName: "Guntur Headquarters",
  latitude: OFFICE.latitude,
  longitude: OFFICE.longitude,
  radiusMeters: 100,
};

function verify(overrides: Partial<Parameters<typeof verifyLocation>[0]> = {}) {
  return verifyLocation({
    reported: { ...OFFICE, accuracyMeters: 12 },
    capturedAt: NOW,
    now: NOW,
    zones: [ZONE],
    previousFix: null,
    policy: DEFAULT_POLICY,
    ...overrides,
  });
}

describe("inside the perimeter", () => {
  it("verifies a fix near the centre", () => {
    const result = verify({ reported: { ...offsetByMeters(OFFICE, 40, 0), accuracyMeters: 10 } });

    expect(result.allowed).toBe(true);
    expect(result.verification).toBe("VERIFIED");
    expect(result.nearestZone?.officeName).toBe("Guntur Headquarters");
    expect(result.distanceMeters).toBeCloseTo(40, 0);
    expect(result.requiredRadiusMeters).toBe(100);
    expect(result.riskFlags).toHaveLength(0);
  });

  it("picks the closest matching zone when several overlap", () => {
    const annexe: GeofenceZone = {
      id: "zone-2",
      officeId: "office-1",
      officeName: "Guntur Annexe",
      ...offsetByMeters(OFFICE, 30, 0),
      radiusMeters: 100,
    };

    const result = verify({
      reported: { ...offsetByMeters(OFFICE, 28, 0), accuracyMeters: 8 },
      zones: [ZONE, annexe],
    });

    expect(result.allowed).toBe(true);
    expect(result.nearestZone?.id).toBe("zone-2");
  });
});

describe("outside the perimeter", () => {
  it("refuses and reports the distance and required radius", () => {
    const result = verify({ reported: { ...offsetByMeters(OFFICE, 248, 0), accuracyMeters: 10 } });

    expect(result.allowed).toBe(false);
    expect(result.verification).toBe("OUTSIDE_GEOFENCE");
    expect(result.distanceMeters).toBeCloseTo(248, 0);
    expect(result.requiredRadiusMeters).toBe(100);
    expect(result.riskFlags).toContain("OUTSIDE_ALL_GEOFENCES");
    expect(result.message).toMatch(/outside your assigned office/i);
  });

  it("records but allows when the organisation does not enforce the geofence", () => {
    const result = verify({
      reported: { ...offsetByMeters(OFFICE, 500, 0), accuracyMeters: 10 },
      policy: { ...DEFAULT_POLICY, enforceGeofence: false },
    });

    // Still reported as outside — the verdict is honest even when permissive.
    expect(result.allowed).toBe(true);
    expect(result.verification).toBe("OUTSIDE_GEOFENCE");
    expect(result.riskFlags).toContain("OUTSIDE_ALL_GEOFENCES");
  });

  it("keeps the nearest zone for the rejection message", () => {
    const far: GeofenceZone = {
      id: "zone-far",
      officeId: "office-2",
      officeName: "Hyderabad Office",
      latitude: 17.44855,
      longitude: 78.39109,
      radiusMeters: 150,
    };

    const result = verify({
      reported: { ...offsetByMeters(OFFICE, 300, 0), accuracyMeters: 10 },
      zones: [ZONE, far],
    });

    expect(result.allowed).toBe(false);
    expect(result.nearestZone?.officeName).toBe("Guntur Headquarters");
  });
});

describe("input validity", () => {
  it("refuses a malformed coordinate", () => {
    const result = verify({ reported: { latitude: 999, longitude: 0, accuracyMeters: 5 } });

    expect(result.allowed).toBe(false);
    expect(result.verification).toBe("NO_LOCATION");
    expect(result.distanceMeters).toBeNull();
  });

  it("refuses (0, 0)", () => {
    const result = verify({ reported: { latitude: 0, longitude: 0, accuracyMeters: 5 } });
    expect(result.verification).toBe("NO_LOCATION");
  });

  it("refuses when the employee has no assigned office", () => {
    const result = verify({ zones: [] });

    expect(result.allowed).toBe(false);
    expect(result.message).toMatch(/don't have an office assigned/i);
  });
});

describe("accuracy gate", () => {
  it("refuses a reading too vague to decide a 100 m perimeter", () => {
    const result = verify({ reported: { ...OFFICE, accuracyMeters: 480 } });

    expect(result.allowed).toBe(false);
    expect(result.verification).toBe("LOW_ACCURACY");
    expect(result.riskFlags).toContain("LOW_ACCURACY");
    expect(result.message).toMatch(/480 m/);
  });

  it("accepts a fix with no accuracy reported at all", () => {
    // Some browsers omit it; absence is not evidence of inaccuracy.
    const result = verify({ reported: { ...OFFICE, accuracyMeters: null } });
    expect(result.allowed).toBe(true);
  });

  it("accepts a reading exactly at the threshold", () => {
    const result = verify({ reported: { ...OFFICE, accuracyMeters: 100 } });
    expect(result.allowed).toBe(true);
  });
});

describe("timestamp checks", () => {
  it("refuses a fix from the future as a suspected spoof", () => {
    const result = verify({ capturedAt: new Date(NOW.getTime() + 120_000) });

    expect(result.allowed).toBe(false);
    expect(result.verification).toBe("SUSPECTED_SPOOF");
    expect(result.riskFlags).toContain("FUTURE_TIMESTAMP");
  });

  it("tolerates small clock skew", () => {
    // 10 seconds ahead is drift, not fraud.
    const result = verify({ capturedAt: new Date(NOW.getTime() + 10_000) });
    expect(result.allowed).toBe(true);
  });

  it("refuses a stale fix", () => {
    const result = verify({ capturedAt: new Date(NOW.getTime() - 600_000) });

    expect(result.allowed).toBe(false);
    expect(result.verification).toBe("LOW_ACCURACY");
    expect(result.riskFlags).toContain("STALE_FIX");
  });

  it("accepts when no device timestamp is supplied", () => {
    const result = verify({ capturedAt: null });
    expect(result.allowed).toBe(true);
  });
});

describe("impossible travel", () => {
  it("flags but still allows movement faster than any aircraft", () => {
    const result = verify({
      previousFix: {
        latitude: 17.44855, // Hyderabad, ~213 km away
        longitude: 78.39109,
        at: new Date(NOW.getTime() - 60_000), // one minute earlier
      },
    });

    // The person IS inside the perimeter, so refusing would punish a
    // legitimate check-in on the strength of a possibly-bad earlier fix.
    // Allowed, marked suspect, and surfaced for review.
    expect(result.allowed).toBe(true);
    expect(result.verification).toBe("SUSPECTED_SPOOF");
    expect(result.riskFlags).toContain("IMPOSSIBLE_TRAVEL");
  });

  it("does not flag an ordinary commute", () => {
    const result = verify({
      // Offset off the exact centre, otherwise EXACT_CENTRE_MATCH fires and
      // masks what this test is actually checking.
      reported: { ...offsetByMeters(OFFICE, 12, 7), accuracyMeters: 9 },
      previousFix: {
        ...offsetByMeters(OFFICE, 15_000, 0),
        at: new Date(NOW.getTime() - 30 * 60_000), // 15 km in 30 min = 30 km/h
      },
    });

    expect(result.riskFlags).not.toContain("IMPOSSIBLE_TRAVEL");
    expect(result.verification).toBe("VERIFIED");
  });
});

describe("hand-typed coordinates", () => {
  it("flags a fix landing exactly on the geofence centre", () => {
    // Real GPS never returns the centre to sub-metre precision.
    const result = verify({ reported: { ...OFFICE, accuracyMeters: 8 } });

    expect(result.allowed).toBe(true);
    expect(result.verification).toBe("SUSPECTED_SPOOF");
    expect(result.riskFlags).toContain("EXACT_CENTRE_MATCH");
  });

  it("does not flag a normal nearby fix", () => {
    const result = verify({ reported: { ...offsetByMeters(OFFICE, 3, 2), accuracyMeters: 8 } });
    expect(result.riskFlags).not.toContain("EXACT_CENTRE_MATCH");
  });
});
