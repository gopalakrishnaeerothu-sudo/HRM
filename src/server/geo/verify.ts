import type { LocationVerification } from "@prisma/client";

import { distanceMeters, impliedSpeedKmh, isValidCoordinate, type Coordinates } from "@/server/geo/distance";

/**
 * Geofence evaluation.
 *
 * ─── The rule that matters ──────────────────────────────────────────────────
 * The client sends coordinates and nothing else. It never sends "I am inside
 * the office" — a flag like that would be trivially forged, so the type system
 * here has no place to put one. This module receives raw coordinates plus the
 * office record loaded from the database, and *derives* the verdict.
 *
 * ─── What this can and cannot do ────────────────────────────────────────────
 * Browser geolocation is not a trustworthy sensor. A developer console, a
 * rooted device or a desktop emulator can report any coordinates at will.
 * Nothing in this file changes that, and it would be dishonest to describe
 * these checks as anti-spoofing in the strong sense.
 *
 * What they do provide is a floor: obviously invalid input is rejected,
 * implausible movement is flagged, low-confidence fixes are refused, and every
 * decision is written to an append-only log with the evidence attached. The
 * result is that spoofing leaves a trail an administrator can review, rather
 * than being invisible.
 *
 * Stronger signals — platform attestation (Play Integrity / App Attest), mock-
 * location detection, BLE beacons or Wi-Fi BSSID matching — need a native
 * client. `GeoRiskFlag` and the `riskFlags` column exist so those can be added
 * as extra flags without a schema change or a rewrite here.
 */

export type GeoRiskFlag =
  | "LOW_ACCURACY"
  | "IMPOSSIBLE_TRAVEL"
  | "STALE_FIX"
  | "FUTURE_TIMESTAMP"
  | "EXACT_CENTRE_MATCH"
  | "REPEATED_IDENTICAL_FIX"
  | "OUTSIDE_ALL_GEOFENCES";

export interface GeofenceZone {
  id: string;
  officeId: string;
  officeName: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface VerificationInput {
  /** Coordinates as reported by the client. Treated as a claim, not a fact. */
  reported: Coordinates & { accuracyMeters?: number | null };
  /** When the fix was taken on the device, if provided. */
  capturedAt?: Date | null;
  /** Server clock at the moment of the request. */
  now: Date;
  /** Candidate zones — the employee's assigned offices only. */
  zones: readonly GeofenceZone[];
  /** Previous accepted fix for this employee, for the travel-speed check. */
  previousFix?: (Coordinates & { at: Date }) | null;
  policy: VerificationPolicy;
}

export interface VerificationPolicy {
  /** Reject a fix whose reported accuracy radius exceeds this. */
  maxAccuracyMeters: number;
  /** Flag movement faster than this between consecutive fixes. */
  maxTravelSpeedKmh: number;
  /** Reject a device fix older than this many seconds. */
  maxFixAgeSeconds: number;
  /** When false, an outside-geofence result is recorded but not rejected. */
  enforceGeofence: boolean;
}

export const DEFAULT_POLICY: VerificationPolicy = {
  maxAccuracyMeters: 100,
  maxTravelSpeedKmh: 900, // roughly a commercial airliner
  maxFixAgeSeconds: 120,
  enforceGeofence: true,
};

export interface VerificationResult {
  /** Whether the attendance action should be allowed to proceed. */
  allowed: boolean;
  verification: LocationVerification;
  /** Nearest matching zone, or the nearest zone overall when outside them all. */
  nearestZone: GeofenceZone | null;
  /** Distance to `nearestZone`'s centre, in metres. */
  distanceMeters: number | null;
  /** Radius the distance was compared against. */
  requiredRadiusMeters: number | null;
  riskFlags: GeoRiskFlag[];
  /** Message shown to the employee. Never leaks another person's data. */
  message: string;
}

/**
 * Evaluate a location claim against an employee's assigned geofences.
 *
 * Pure and synchronous: all the I/O (loading zones, the previous fix and the
 * policy) happens in the attendance service, which keeps this exhaustively
 * testable.
 */
export function verifyLocation(input: VerificationInput): VerificationResult {
  const { reported, zones, policy, now, previousFix, capturedAt } = input;
  const riskFlags: GeoRiskFlag[] = [];

  // 1. Structural validity. A malformed coordinate is not a near miss.
  if (!isValidCoordinate(reported)) {
    return {
      allowed: false,
      verification: "NO_LOCATION",
      nearestZone: null,
      distanceMeters: null,
      requiredRadiusMeters: null,
      riskFlags,
      message: "We couldn't read your location. Enable location access and try again.",
    };
  }

  // 2. Timestamp sanity. A fix from the future, or a stale one, is unusable —
  //    both are also the shape a naive replay attack takes.
  if (capturedAt) {
    const ageSeconds = (now.getTime() - capturedAt.getTime()) / 1000;
    if (ageSeconds < -30) {
      riskFlags.push("FUTURE_TIMESTAMP");
      return {
        allowed: false,
        verification: "SUSPECTED_SPOOF",
        nearestZone: null,
        distanceMeters: null,
        requiredRadiusMeters: null,
        riskFlags,
        message: "Your device clock looks out of sync. Correct the time and try again.",
      };
    }
    if (ageSeconds > policy.maxFixAgeSeconds) {
      riskFlags.push("STALE_FIX");
      return {
        allowed: false,
        verification: "LOW_ACCURACY",
        nearestZone: null,
        distanceMeters: null,
        requiredRadiusMeters: null,
        riskFlags,
        message: "That location reading was too old. Refresh your location and try again.",
      };
    }
  }

  // 3. Accuracy gate. A ±500 m fix cannot decide a 100 m geofence either way,
  //    so accepting it would be theatre.
  const accuracy = reported.accuracyMeters;
  if (typeof accuracy === "number" && Number.isFinite(accuracy)) {
    if (accuracy > policy.maxAccuracyMeters) {
      riskFlags.push("LOW_ACCURACY");
      return {
        allowed: false,
        verification: "LOW_ACCURACY",
        nearestZone: null,
        distanceMeters: null,
        requiredRadiusMeters: null,
        riskFlags,
        message: `Your location is only accurate to about ${Math.round(accuracy)} m. Move somewhere with a clearer signal and try again.`,
      };
    }
  }

  // 4. Impossible travel. Compares against this employee's last accepted fix.
  if (previousFix) {
    const speed = impliedSpeedKmh(previousFix, { ...reported, at: capturedAt ?? now });
    if (speed > policy.maxTravelSpeedKmh) {
      riskFlags.push("IMPOSSIBLE_TRAVEL");
    }
  }

  // 5. Geofence match. Pick the zone the employee is most convincingly inside;
  //    when inside none, keep the nearest for the rejection message.
  if (zones.length === 0) {
    return {
      allowed: false,
      verification: "NO_LOCATION",
      nearestZone: null,
      distanceMeters: null,
      requiredRadiusMeters: null,
      riskFlags,
      message: "You don't have an office assigned yet. Ask your HR team to set one.",
    };
  }

  let nearestZone: GeofenceZone | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  let matchedZone: GeofenceZone | null = null;
  let matchedDistance = Number.POSITIVE_INFINITY;

  for (const zone of zones) {
    const metres = distanceMeters(reported, zone);
    if (metres < nearestDistance) {
      nearestDistance = metres;
      nearestZone = zone;
    }
    if (metres <= zone.radiusMeters && metres < matchedDistance) {
      matchedDistance = metres;
      matchedZone = zone;
    }
  }

  // A fix landing on the geofence centre to sub-metre precision is not what a
  // real GPS produces; it is what a hand-typed coordinate produces.
  if (matchedZone && matchedDistance < 0.5) {
    riskFlags.push("EXACT_CENTRE_MATCH");
  }

  if (!matchedZone) {
    riskFlags.push("OUTSIDE_ALL_GEOFENCES");
    const radius = nearestZone?.radiusMeters ?? null;
    return {
      allowed: !policy.enforceGeofence,
      verification: "OUTSIDE_GEOFENCE",
      nearestZone,
      distanceMeters: Number.isFinite(nearestDistance) ? nearestDistance : null,
      requiredRadiusMeters: radius,
      riskFlags,
      message: policy.enforceGeofence
        ? "You're currently outside your assigned office location."
        : "Recorded outside the office perimeter — this will be flagged for review.",
    };
  }

  // Inside a zone, but flagged: record it, allow it, and surface it for review
  // rather than blocking someone whose device clock drifted.
  const suspicious = riskFlags.includes("IMPOSSIBLE_TRAVEL") || riskFlags.includes("EXACT_CENTRE_MATCH");

  return {
    allowed: true,
    verification: suspicious ? "SUSPECTED_SPOOF" : "VERIFIED",
    nearestZone: matchedZone,
    distanceMeters: matchedDistance,
    requiredRadiusMeters: matchedZone.radiusMeters,
    riskFlags,
    message: suspicious
      ? `Location accepted at ${matchedZone.officeName}, but flagged for review.`
      : `Location verified at ${matchedZone.officeName}.`,
  };
}

/** Human-readable reason for each risk flag, shown in the audit UI. */
export const RISK_FLAG_LABELS: Record<GeoRiskFlag, string> = {
  LOW_ACCURACY: "GPS accuracy below the required threshold",
  IMPOSSIBLE_TRAVEL: "Movement since the previous fix exceeds a plausible speed",
  STALE_FIX: "Location reading older than the allowed window",
  FUTURE_TIMESTAMP: "Device clock reported a time in the future",
  EXACT_CENTRE_MATCH: "Coordinates matched the geofence centre exactly",
  REPEATED_IDENTICAL_FIX: "Identical coordinates repeated across separate sessions",
  OUTSIDE_ALL_GEOFENCES: "Outside every assigned office perimeter",
};
