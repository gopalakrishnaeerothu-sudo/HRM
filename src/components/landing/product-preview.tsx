"use client";

import * as React from "react";
import { motion, useInView, useReducedMotion, animate } from "framer-motion";
import {
  ArrowUpRight,
  CalendarCheck,
  CheckCircle2,
  Clock3,
  ListTodo,
  MapPin,
  Users,
} from "lucide-react";

import { cn, formatNumber } from "@/lib/utils";
import { Reveal, Section, SectionHeading } from "@/components/landing/section";

/**
 * An animated mock of the real dashboard.
 *
 * The numbers are illustrative and match the seeded demo organisation, so what
 * a visitor sees here is what they get after `npm run db:seed`.
 */

const TILES = [
  { label: "Total employees", value: 240, icon: Users, tone: "brand" as const, delta: "+6 this month" },
  { label: "Present today", value: 218, icon: CalendarCheck, tone: "success" as const, delta: "91% attendance" },
  { label: "Active tasks", value: 87, icon: ListTodo, tone: "info" as const, delta: "31 in progress" },
  { label: "Completed", value: 42, icon: CheckCircle2, tone: "success" as const, delta: "this week" },
  { label: "Productivity", value: 93, suffix: "%", icon: ArrowUpRight, tone: "brand" as const, delta: "+4.2 pts" },
  { label: "Offices online", value: 2, icon: MapPin, tone: "warning" as const, delta: "Guntur · Hyderabad" },
];

const TONE_CLASSES = {
  brand: "bg-brand-soft text-brand",
  success: "bg-success-soft text-success",
  info: "bg-info-soft text-info",
  warning: "bg-warning-soft text-warning",
} as const;

/** Counts up when the tile scrolls into view. */
function CountUp({ value, suffix }: { value: number; suffix?: string }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const reduceMotion = useReducedMotion();
  const [display, setDisplay] = React.useState(reduceMotion ? value : 0);

  React.useEffect(() => {
    if (!inView || reduceMotion) return;
    const controls = animate(0, value, {
      duration: 1.1,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (latest) => setDisplay(latest),
    });
    return () => controls.stop();
  }, [inView, value, reduceMotion]);

  return (
    <span ref={ref}>
      {formatNumber(display)}
      {suffix}
    </span>
  );
}

/** Small bar chart, drawn with divs so it stays crisp and needs no library. */
function MiniBars() {
  const bars = [52, 68, 61, 79, 72, 88, 84, 93, 76, 90, 82, 95];
  const reduceMotion = useReducedMotion();

  return (
    <div className="flex h-28 items-end gap-1.5" aria-hidden>
      {bars.map((height, index) => (
        <motion.div
          key={index}
          className={cn(
            "flex-1 rounded-t-[3px]",
            index === bars.length - 1 ? "bg-brand" : "bg-brand/35",
          )}
          initial={reduceMotion ? false : { height: 0 }}
          whileInView={{ height: `${height}%` }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.6, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }}
          style={reduceMotion ? { height: `${height}%` } : undefined}
        />
      ))}
    </div>
  );
}

const ACTIVITY = [
  { time: "09:14", text: "Priya checked in at Guntur HQ", tone: "success" as const },
  { time: "09:31", text: "Rahul moved “Payment retry” to In review", tone: "info" as const },
  { time: "10:02", text: "Ananya requested 2 days of casual leave", tone: "brand" as const },
  { time: "10:18", text: "Check-in rejected — 248 m outside perimeter", tone: "critical" as const },
];

const ACTIVITY_DOT = {
  success: "bg-success",
  info: "bg-info",
  brand: "bg-brand",
  critical: "bg-critical",
} as const;

export function ProductPreview() {
  return (
    <Section id="product" className="pt-4">
      <SectionHeading
        eyebrow="The dashboard"
        eyebrowIcon={Clock3}
        title="Everything about today, on one screen"
        description="Head count, attendance, task flow and office status update together — so the morning stand-up question is already answered before anyone asks it."
      />

      <Reveal delay={0.1} className="mt-14">
        <div className="glass-card overflow-hidden p-2 shadow-float sm:p-3">
          {/* Chrome bar, to read as an application window. */}
          <div className="flex items-center gap-2 px-3 py-2.5">
            <span className="flex gap-1.5" aria-hidden>
              <span className="size-2.5 rounded-full bg-critical/70" />
              <span className="size-2.5 rounded-full bg-warning/70" />
              <span className="size-2.5 rounded-full bg-success/70" />
            </span>
            <span className="ml-2 truncate rounded-md bg-surface-2 px-2.5 py-1 text-[0.6875rem] text-ink-muted">
              app.taskflow-hr.example / dashboard
            </span>
          </div>

          <div className="rounded-xl bg-surface-2/60 p-3 sm:p-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {TILES.map((tile, index) => (
                <motion.div
                  key={tile.label}
                  initial={{ opacity: 0, y: 16 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.3 }}
                  transition={{ duration: 0.5, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
                  className="rounded-xl border border-line bg-surface-1 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs font-medium text-ink-muted">{tile.label}</p>
                    <span
                      className={cn(
                        "flex size-8 shrink-0 items-center justify-center rounded-lg",
                        TONE_CLASSES[tile.tone],
                      )}
                      aria-hidden
                    >
                      <tile.icon className="size-4" />
                    </span>
                  </div>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-ink">
                    <CountUp value={tile.value} suffix={tile.suffix} />
                  </p>
                  <p className="mt-1 text-[0.6875rem] text-ink-muted">{tile.delta}</p>
                </motion.div>
              ))}
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-[1.4fr_1fr]">
              <div className="rounded-xl border border-line bg-surface-1 p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-semibold text-ink">Attendance, last 12 days</p>
                  <p className="text-xs text-ink-muted">Peak 95%</p>
                </div>
                <div className="mt-4">
                  <MiniBars />
                </div>
              </div>

              <div className="rounded-xl border border-line bg-surface-1 p-4">
                <p className="text-sm font-semibold text-ink">Live activity</p>
                <ul className="mt-4 flex flex-col gap-3.5">
                  {ACTIVITY.map((item) => (
                    <li key={item.text} className="flex gap-3">
                      <span className="mt-1.5 flex flex-col items-center gap-1" aria-hidden>
                        <span className={cn("size-2 rounded-full", ACTIVITY_DOT[item.tone])} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs leading-snug text-ink">{item.text}</p>
                        <p className="mt-0.5 text-[0.6875rem] tabular text-ink-muted">{item.time}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
