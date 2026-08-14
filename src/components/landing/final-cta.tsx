"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Building2, CheckCircle2, Users } from "lucide-react";

import { branding } from "@/lib/branding";
import { Button } from "@/components/ui/button";
import { Reveal, Section } from "@/components/landing/section";

/** Closing section: one clear action, with a small animated product motif. */
export function FinalCta() {
  const reduceMotion = useReducedMotion();

  const orbit = reduceMotion
    ? {}
    : {
        animate: { rotate: 360 },
        transition: { duration: 40, repeat: Infinity, ease: "linear" as const },
      };

  return (
    <Section className="pb-28">
      <Reveal>
        <div className="relative overflow-hidden rounded-3xl border border-line bg-surface-1 px-6 py-16 text-center sm:px-12 sm:py-20">
          <div className="aurora opacity-90" aria-hidden />

          {/* Slowly rotating rings behind the copy. */}
          <motion.div
            className="pointer-events-none absolute left-1/2 top-1/2 -z-0 size-[38rem] -translate-x-1/2 -translate-y-1/2"
            aria-hidden
            {...orbit}
          >
            <div className="absolute inset-0 rounded-full border border-brand/15" />
            <div className="absolute inset-[12%] rounded-full border border-brand/12" />
            <div className="absolute inset-[26%] rounded-full border border-brand/10" />
            <span className="absolute left-1/2 top-0 size-3 -translate-x-1/2 rounded-full bg-brand shadow-[0_0_20px_var(--brand-glow)]" />
            <span className="absolute bottom-[12%] right-[8%] size-2.5 rounded-full bg-accent" />
          </motion.div>

          <div className="relative z-10 mx-auto flex max-w-2xl flex-col items-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-1/80 px-3.5 py-1.5 text-xs font-medium text-brand backdrop-blur">
              <CheckCircle2 className="size-3.5" aria-hidden />
              Seeded demo data included
            </span>

            <h2 className="mt-6 text-3xl font-semibold leading-[1.12] tracking-tight text-ink sm:text-4xl lg:text-5xl">
              Manage people. Track work.{" "}
              <span className="text-gradient">Understand productivity.</span>
            </h2>

            <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-muted sm:text-lg">
              Run {branding.name} against a seeded organisation with two offices, five departments
              and a month of realistic attendance — the dashboard is populated the moment you open it.
            </p>

            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <Button size="lg" asChild>
                <Link href="/app">
                  Open the workspace
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              </Button>
              <Button size="lg" variant="secondary" asChild>
                <Link href="/app/locations">
                  <Building2 className="size-4" aria-hidden />
                  See office geofences
                </Link>
              </Button>
            </div>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-xs text-ink-muted">
              <span className="flex items-center gap-2">
                <Users className="size-3.5" aria-hidden />
                Admin, HR, Manager and Employee views
              </span>
              <span className="flex items-center gap-2">
                <CheckCircle2 className="size-3.5" aria-hidden />
                PostgreSQL-backed, multi-tenant
              </span>
            </div>
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
