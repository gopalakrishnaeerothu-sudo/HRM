"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, CheckCircle2, PlayCircle, Sparkles } from "lucide-react";

import { branding } from "@/lib/branding";
import { Button } from "@/components/ui/button";
import { HeroVisual } from "@/components/landing/hero-visual";

const PROOF_POINTS = [
  "Server-verified geofenced attendance",
  "Tasks, teams and workload in one board",
  "Multi-tenant from day one",
];

const STATS = [
  { value: "240", label: "employees tracked" },
  { value: "2", label: "office locations" },
  { value: "100 m", label: "default perimeter" },
  { value: "< 1 s", label: "check-in verification" },
];

export function Hero() {
  const reduceMotion = useReducedMotion();

  const rise = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 24 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] as const },
        };

  return (
    <section className="relative overflow-hidden px-5 pb-16 pt-28 sm:px-8 sm:pb-24 sm:pt-36">
      <div className="aurora" aria-hidden />
      <div className="absolute inset-0 -z-10 grid-backdrop opacity-60" aria-hidden />

      <div className="mx-auto grid w-full max-w-7xl items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-8">
        <div className="flex min-w-0 flex-col items-start">
          <motion.div {...rise(0)}>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-1/70 px-3.5 py-1.5 text-xs font-medium text-ink-secondary backdrop-blur">
              <Sparkles className="size-3.5 text-brand" aria-hidden />
              People · Tasks · Attendance · Location
            </span>
          </motion.div>

          <motion.h1
            {...rise(0.08)}
            className="mt-6 text-[2.5rem] font-semibold leading-[1.08] tracking-tight text-ink sm:text-5xl lg:text-6xl"
          >
            One workspace for your{" "}
            <span className="text-gradient">people, tasks and attendance.</span>
          </motion.h1>

          <motion.p
            {...rise(0.16)}
            className="mt-6 max-w-xl text-base leading-relaxed text-ink-secondary sm:text-lg"
          >
            {branding.name} brings your team directory, task board and location-verified attendance
            into a single system — so you can see who is in, what they are working on, and how the
            work is actually going.
          </motion.p>

          <motion.div {...rise(0.24)} className="mt-9 flex flex-wrap items-center gap-3">
            <Button size="lg" asChild>
              <Link href="/app">
                Get started
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
            <Button size="lg" variant="secondary" asChild>
              <Link href="#product">
                <PlayCircle className="size-4" aria-hidden />
                Explore the platform
              </Link>
            </Button>
          </motion.div>

          <motion.ul {...rise(0.32)} className="mt-8 flex flex-col gap-2.5">
            {PROOF_POINTS.map((point) => (
              <li key={point} className="flex items-center gap-2.5 text-sm text-ink-secondary">
                <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
                {point}
              </li>
            ))}
          </motion.ul>

          <motion.dl
            {...rise(0.4)}
            className="mt-10 grid w-full max-w-lg grid-cols-2 gap-x-6 gap-y-5 border-t border-line pt-7 sm:grid-cols-4"
          >
            {STATS.map((stat) => (
              <div key={stat.label} className="min-w-0">
                <dt className="sr-only">{stat.label}</dt>
                <dd className="text-2xl font-semibold tracking-tight text-ink">{stat.value}</dd>
                <p className="mt-0.5 text-xs leading-snug text-ink-muted">{stat.label}</p>
              </div>
            ))}
          </motion.dl>
        </div>

        <motion.div
          {...(reduceMotion
            ? {}
            : {
                initial: { opacity: 0, scale: 0.94 },
                animate: { opacity: 1, scale: 1 },
                transition: { duration: 0.9, delay: 0.2, ease: [0.22, 1, 0.36, 1] as const },
              })}
          className="flex min-w-0 justify-center lg:justify-end"
        >
          <HeroVisual />
        </motion.div>
      </div>
    </section>
  );
}
