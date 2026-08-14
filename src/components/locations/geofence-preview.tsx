"use client";

import * as React from "react";

import { clamp } from "@/lib/utils";

/**
 * Scale-accurate geofence preview.
 *
 * The circle is drawn against a metre grid that adapts to the radius, so
 * changing 100 m → 500 m visibly grows the covered area rather than just
 * relabelling the same picture. That is the point: an admin adjusting the
 * radius should see what they are actually widening.
 *
 * No map tiles are loaded — this is a schematic, and fetching a third-party
 * basemap would leak office coordinates to that provider.
 */

const SIZE = 260;
const CENTRE = SIZE / 2;
/** The circle always occupies this fraction of the box; the grid rescales. */
const CIRCLE_RADIUS_PX = 78;

/** Pick a round grid spacing that yields 3–8 visible lines. */
function gridSpacingMeters(radiusMeters: number): number {
  const target = radiusMeters / 2.5;
  const steps = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
  return steps.find((step) => step >= target) ?? 5000;
}

export function GeofencePreview({
  radiusMeters,
  officeName,
}: {
  radiusMeters: number;
  officeName: string;
}) {
  const safeRadius = clamp(Number.isFinite(radiusMeters) ? radiusMeters : 100, 1, 5000);
  const metersPerPx = safeRadius / CIRCLE_RADIUS_PX;
  const spacing = gridSpacingMeters(safeRadius);
  const spacingPx = spacing / metersPerPx;

  const gridLines = React.useMemo(() => {
    const lines: number[] = [];
    for (let offset = spacingPx; offset < CENTRE; offset += spacingPx) {
      lines.push(offset);
    }
    return lines;
  }, [spacingPx]);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-2/40">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-full"
        role="img"
        aria-label={`Schematic of the ${radiusMeters} metre geofence around ${officeName}, with grid lines every ${spacing} metres`}
      >
        <defs>
          <radialGradient id={`fence-${officeName.replace(/\W/g, "")}`}>
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.20" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.05" />
          </radialGradient>
        </defs>

        {/* Metre grid */}
        {gridLines.map((offset) => (
          <g key={offset} stroke="var(--line)" strokeWidth="1">
            <line x1={CENTRE - offset} y1="0" x2={CENTRE - offset} y2={SIZE} />
            <line x1={CENTRE + offset} y1="0" x2={CENTRE + offset} y2={SIZE} />
            <line x1="0" y1={CENTRE - offset} x2={SIZE} y2={CENTRE - offset} />
            <line x1="0" y1={CENTRE + offset} x2={SIZE} y2={CENTRE + offset} />
          </g>
        ))}

        {/* Axes through the centre */}
        <line x1={CENTRE} y1="0" x2={CENTRE} y2={SIZE} stroke="var(--line-strong)" strokeWidth="1" />
        <line x1="0" y1={CENTRE} x2={SIZE} y2={CENTRE} stroke="var(--line-strong)" strokeWidth="1" />

        {/* The perimeter */}
        <circle
          cx={CENTRE}
          cy={CENTRE}
          r={CIRCLE_RADIUS_PX}
          fill={`url(#fence-${officeName.replace(/\W/g, "")})`}
        />
        <circle
          cx={CENTRE}
          cy={CENTRE}
          r={CIRCLE_RADIUS_PX}
          fill="none"
          stroke="var(--brand)"
          strokeWidth="2"
          strokeDasharray="6 4"
        />

        {/* Radius callout */}
        <line
          x1={CENTRE}
          y1={CENTRE}
          x2={CENTRE + CIRCLE_RADIUS_PX}
          y2={CENTRE}
          stroke="var(--brand)"
          strokeWidth="1.5"
        />
        <text
          x={CENTRE + CIRCLE_RADIUS_PX / 2}
          y={CENTRE - 8}
          textAnchor="middle"
          className="fill-[var(--brand)] text-[11px] font-semibold"
        >
          {Math.round(safeRadius)} m
        </text>

        {/* Office marker */}
        <rect x={CENTRE - 13} y={CENTRE - 13} width="26" height="26" rx="7" fill="var(--brand)" />
        <path
          d="M -6 5 L -6 -3 L 0 -7 L 6 -3 L 6 5 Z"
          transform={`translate(${CENTRE} ${CENTRE})`}
          fill="none"
          stroke="white"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />

        <text
          x={CENTRE}
          y={SIZE - 10}
          textAnchor="middle"
          className="fill-[var(--ink-muted)] text-[10px]"
        >
          grid = {spacing} m
        </text>
      </svg>
    </div>
  );
}
