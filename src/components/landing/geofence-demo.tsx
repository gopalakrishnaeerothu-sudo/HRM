"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Building2, MapPin, Radar, ShieldCheck, ShieldX } from "lucide-react";

import { cn, formatDistance } from "@/lib/utils";
import { FeatureList, Section, SectionHeading, SplitLayout } from "@/components/landing/section";

/**
 * Animated geofence explainer.
 *
 * Two employees walk a looping path: one crosses into the perimeter and is
 * verified, one stays outside and is refused. The distance readout is computed
 * from the same geometry the SVG draws, so the number always matches the
 * picture.
 *
 * The scene is illustrative, but it is deliberately faithful about the one
 * thing that matters: the verdict is a function of distance versus radius, and
 * being outside means the check-in does not happen.
 */

const VIEWBOX = 420;
const CENTRE = VIEWBOX / 2;
const RADIUS_PX = 120;
/** The perimeter this illustration represents. */
const RADIUS_METERS = 100;
const METERS_PER_PX = RADIUS_METERS / RADIUS_PX;

/** Path points in SVG space; index 0 is the loop start. */
const INSIDE_PATH = [
  { x: 40, y: 330 },
  { x: 110, y: 300 },
  { x: 165, y: 250 },
  { x: 196, y: 214 },
];

const OUTSIDE_PATH = [
  { x: 392, y: 96 },
  { x: 368, y: 132 },
  { x: 352, y: 158 },
  { x: 344, y: 176 },
];

function distanceFromCentre(point: { x: number; y: number }): number {
  return Math.hypot(point.x - CENTRE, point.y - CENTRE) * METERS_PER_PX;
}

function pointsToPath(points: Array<{ x: number; y: number }>): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function Walker({
  path,
  color,
  delay,
  animate,
  label,
}: {
  path: Array<{ x: number; y: number }>;
  color: string;
  delay: number;
  animate: boolean;
  label: string;
}) {
  const last = path[path.length - 1];
  const first = path[0];

  if (!animate) {
    return (
      <g>
        <circle cx={last.x} cy={last.y} r="13" fill={color} fillOpacity="0.18" />
        <circle cx={last.x} cy={last.y} r="7" fill={color} />
        <title>{label}</title>
      </g>
    );
  }

  return (
    <motion.g
      initial={{ x: first.x, y: first.y }}
      animate={{ x: path.map((point) => point.x), y: path.map((point) => point.y) }}
      transition={{
        duration: 4.5,
        delay,
        repeat: Infinity,
        repeatType: "reverse",
        ease: "easeInOut",
        times: [0, 0.35, 0.7, 1],
      }}
    >
      <circle r="13" fill={color} fillOpacity="0.18" />
      <circle r="7" fill={color} />
      <title>{label}</title>
    </motion.g>
  );
}

function GeofenceMap() {
  const reduceMotion = useReducedMotion();
  const animate = !reduceMotion;

  const insideDistance = distanceFromCentre(INSIDE_PATH[INSIDE_PATH.length - 1]);
  const outsideDistance = distanceFromCentre(OUTSIDE_PATH[OUTSIDE_PATH.length - 1]);

  return (
    <div className="glass-card overflow-hidden p-4 sm:p-6">
      <div className="relative">
        <svg viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`} className="w-full" role="img" aria-labelledby="geofence-title">
          <title id="geofence-title">
            Map showing an office at the centre of a 100 metre geofence, one employee inside the
            perimeter and one outside it
          </title>

          <defs>
            <radialGradient id="fence-fill">
              <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.16" />
              <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.04" />
            </radialGradient>
            <pattern id="map-grid" width="42" height="42" patternUnits="userSpaceOnUse">
              <path d="M 42 0 L 0 0 0 42" fill="none" stroke="var(--line)" strokeWidth="1" />
            </pattern>
          </defs>

          <rect width={VIEWBOX} height={VIEWBOX} fill="url(#map-grid)" rx="16" />

          {/* Perimeter */}
          <circle cx={CENTRE} cy={CENTRE} r={RADIUS_PX} fill="url(#fence-fill)" />
          <circle
            cx={CENTRE}
            cy={CENTRE}
            r={RADIUS_PX}
            fill="none"
            stroke="var(--brand)"
            strokeWidth="2.5"
            strokeDasharray="7 5"
          />

          {/* Expanding radar sweep */}
          {animate ? (
            <motion.circle
              cx={CENTRE}
              cy={CENTRE}
              r={RADIUS_PX}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              initial={{ scale: 0.45, opacity: 0.55 }}
              animate={{ scale: 1.06, opacity: 0 }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeOut" }}
              style={{ transformOrigin: `${CENTRE}px ${CENTRE}px` }}
            />
          ) : null}

          {/* Walk paths */}
          <path d={pointsToPath(INSIDE_PATH)} fill="none" stroke="var(--success)" strokeWidth="1.5" strokeDasharray="4 6" strokeOpacity="0.5" />
          <path d={pointsToPath(OUTSIDE_PATH)} fill="none" stroke="var(--critical)" strokeWidth="1.5" strokeDasharray="4 6" strokeOpacity="0.5" />

          {/* Office */}
          <g>
            <rect x={CENTRE - 34} y={CENTRE - 34} width="68" height="68" rx="14" fill="var(--brand)" />
            <rect x={CENTRE - 34} y={CENTRE - 34} width="68" height="68" rx="14" fill="none" stroke="white" strokeOpacity="0.25" strokeWidth="1.5" />
            <path
              d="M -13 12 L -13 -8 L 0 -16 L 13 -8 L 13 12 Z M -5 12 L -5 1 L 5 1 L 5 12"
              transform={`translate(${CENTRE} ${CENTRE})`}
              fill="none"
              stroke="white"
              strokeWidth="2.2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>

          <Walker path={INSIDE_PATH} color="var(--success)" delay={0} animate={animate} label="Employee inside the perimeter" />
          <Walker path={OUTSIDE_PATH} color="var(--critical)" delay={0.8} animate={animate} label="Employee outside the perimeter" />

          <text x={CENTRE} y={CENTRE + RADIUS_PX + 24} textAnchor="middle" className="fill-[var(--ink-muted)] text-[13px]">
            {RADIUS_METERS} m geofence radius
          </text>
        </svg>
      </div>

      {/* Verdict cards — the same two outcomes the API returns. */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-success/25 bg-success-soft/60 p-3.5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 shrink-0 text-success" aria-hidden />
            <p className="text-sm font-semibold text-success">Check-in allowed</p>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">
            {formatDistance(insideDistance)} from centre · within {RADIUS_METERS} m
          </p>
        </div>

        <div className="rounded-xl border border-critical/25 bg-critical-soft/60 p-3.5">
          <div className="flex items-center gap-2">
            <ShieldX className="size-4 shrink-0 text-critical" aria-hidden />
            <p className="text-sm font-semibold text-critical">Check-in refused</p>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">
            {formatDistance(outsideDistance)} from centre · outside {RADIUS_METERS} m
          </p>
        </div>
      </div>
    </div>
  );
}

const FEATURES = [
  {
    icon: MapPin,
    title: "Draw a perimeter per office",
    body: "Set the coordinates and radius for each site. Add extra zones for an annexe or car park — nothing is hard-coded.",
  },
  {
    icon: Radar,
    title: "The server decides, not the browser",
    body: "The client sends coordinates and nothing else. Distance, office match and the verdict are computed server-side, every time.",
  },
  {
    icon: Building2,
    title: "Every attempt is recorded",
    body: "Accepted or refused, each try is written to an append-only log with its coordinates, accuracy and risk flags.",
  },
];

export function GeofenceSection() {
  return (
    <Section id="geofencing" className="relative">
      <div
        className="absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-line-strong to-transparent"
        aria-hidden
      />
      <SplitLayout media={<GeofenceMap />}>
        <SectionHeading
          align="left"
          eyebrow="Geofencing"
          eyebrowIcon={Radar}
          title="Attendance you can actually trust"
          description="Employees check in from their phone or laptop. The server matches their coordinates against the perimeter you drew and decides — before any attendance is recorded."
        />
        <FeatureList items={FEATURES} />

        <p className="mt-8 rounded-xl border border-line bg-surface-2/50 p-4 text-xs leading-relaxed text-ink-muted">
          <strong className="font-semibold text-ink-secondary">Worth being straight about:</strong>{" "}
          browser GPS can be spoofed, and no web app can fully prevent that. What this does is
          reject invalid, stale and low-accuracy readings, flag impossible travel, and leave an
          audit trail — so tampering is visible rather than silent. Native attestation slots into
          the same interface when you need more.
        </p>
      </SplitLayout>
    </Section>
  );
}

export { GeofenceMap };

/** Small helper for tests and the settings preview. */
export function radiusPreviewMeters(pixels: number): number {
  return pixels * METERS_PER_PX;
}

export const GEOFENCE_DEMO_CONSTANTS = { VIEWBOX, CENTRE, RADIUS_PX, RADIUS_METERS };

export function classesForVerdict(allowed: boolean): string {
  return cn(allowed ? "text-success" : "text-critical");
}
