"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { motion, useReducedMotion } from "framer-motion";
import { Building2, MapPin, ShieldCheck } from "lucide-react";

/**
 * Wrapper that decides whether the 3D hero can run, and renders a designed
 * fallback when it can't.
 *
 * Three gates before three.js is even fetched:
 *  1. WebGL support — checked by trying to acquire a context.
 *  2. Viewport width — phones get the 2D composition, which is lighter and
 *     reads better at that size.
 *  3. `prefers-reduced-motion` still loads the scene but freezes it, so the
 *     visual is not lost for users who only asked for less movement.
 *
 * The fallback is not an apology: it is a flat version of the same idea, so a
 * machine without WebGL still sees an office, a perimeter and people.
 */

const OfficeScene = dynamic(() => import("@/components/landing/office-scene"), {
  ssr: false,
  loading: () => <SceneSkeleton />,
});

function detectWebGL(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const context =
      canvas.getContext("webgl2") ??
      canvas.getContext("webgl") ??
      canvas.getContext("experimental-webgl");
    return Boolean(context);
  } catch {
    return false;
  }
}

function SceneSkeleton() {
  return (
    <div className="flex size-full items-center justify-center" aria-hidden>
      <div className="size-56 animate-pulse rounded-full bg-brand-soft blur-2xl" />
    </div>
  );
}

/** Flat SVG composition: office, geofence rings, four employee markers. */
function StaticFallback() {
  return (
    <div className="relative flex size-full items-center justify-center" aria-hidden>
      <svg viewBox="0 0 400 340" className="size-full max-w-lg" role="presentation">
        <defs>
          <linearGradient id="hero-building" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#eef2ff" />
            <stop offset="100%" stopColor="#c7d2fe" />
          </linearGradient>
          <radialGradient id="hero-glow">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
          </radialGradient>
        </defs>

        <ellipse cx="200" cy="250" rx="180" ry="70" fill="url(#hero-glow)" />
        <ellipse cx="200" cy="250" rx="150" ry="58" fill="none" stroke="var(--brand)" strokeOpacity="0.55" strokeWidth="2" />
        <ellipse cx="200" cy="250" rx="100" ry="39" fill="none" stroke="var(--brand)" strokeOpacity="0.25" strokeWidth="1.5" />
        <ellipse cx="200" cy="250" rx="52" ry="20" fill="none" stroke="var(--brand)" strokeOpacity="0.2" strokeWidth="1.5" />

        <rect x="158" y="150" width="84" height="86" rx="8" fill="url(#hero-building)" />
        <rect x="171" y="110" width="58" height="46" rx="7" fill="#c7d2fe" />
        <rect x="184" y="80" width="32" height="34" rx="6" fill="var(--brand)" />
        <rect x="166" y="172" width="68" height="9" rx="4" fill="var(--accent)" fillOpacity="0.55" />
        <rect x="166" y="196" width="68" height="9" rx="4" fill="var(--accent)" fillOpacity="0.55" />

        {[
          { cx: 120, cy: 262, fill: "var(--accent)" },
          { cx: 268, cy: 250, fill: "#34d399" },
          { cx: 196, cy: 292, fill: "#a855f7" },
          { cx: 348, cy: 236, fill: "#fb7185" },
        ].map((marker) => (
          <g key={`${marker.cx}-${marker.cy}`}>
            <circle cx={marker.cx} cy={marker.cy} r="9" fill={marker.fill} fillOpacity="0.22" />
            <circle cx={marker.cx} cy={marker.cy} r="4.5" fill={marker.fill} />
          </g>
        ))}
      </svg>
    </div>
  );
}

export function HeroVisual() {
  const [mode, setMode] = React.useState<"pending" | "3d" | "flat">("pending");
  const reduceMotion = useReducedMotion();

  React.useEffect(() => {
    const isNarrow = window.matchMedia("(max-width: 767px)").matches;
    setMode(!isNarrow && detectWebGL() ? "3d" : "flat");
  }, []);

  return (
    <div className="relative aspect-square w-full max-w-[34rem] sm:aspect-[4/3] lg:aspect-square">
      {/* Ambient wash sits behind whichever visual renders. */}
      <div className="absolute inset-0 -z-10 rounded-full bg-[radial-gradient(circle_at_50%_45%,var(--aurora-1),transparent_62%)] blur-2xl" />

      {mode === "pending" ? <SceneSkeleton /> : null}
      {mode === "3d" ? <OfficeScene /> : null}
      {mode === "flat" ? <StaticFallback /> : null}

      {/* Overlay chips — real DOM, so they stay crisp and readable in both
          modes and are announced to screen readers as the scene's content. */}
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="absolute -left-2 top-6 hidden sm:block"
      >
        <div className="glass-card flex items-center gap-2.5 px-3 py-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-success-soft text-success">
            <ShieldCheck className="size-4" />
          </span>
          <div>
            <p className="text-xs font-semibold text-ink">Location verified</p>
            <p className="text-[0.6875rem] text-ink-muted">42 m from centre</p>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="absolute -right-2 bottom-10 hidden sm:block"
      >
        <div className="glass-card flex items-center gap-2.5 px-3 py-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <Building2 className="size-4" />
          </span>
          <div>
            <p className="text-xs font-semibold text-ink">Guntur HQ</p>
            <p className="text-[0.6875rem] text-ink-muted">100 m perimeter</p>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.9, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="absolute bottom-0 left-1/2 hidden -translate-x-1/2 lg:block"
      >
        <div className="glass-card flex items-center gap-2 px-3 py-1.5">
          <MapPin className="size-3.5 text-critical" />
          <p className="text-[0.6875rem] font-medium text-ink">1 person outside the perimeter</p>
        </div>
      </motion.div>

      <p className="sr-only">
        Illustration: an office building surrounded by a circular geofence, with employee markers
        inside the perimeter and one outside it.
      </p>
    </div>
  );
}
