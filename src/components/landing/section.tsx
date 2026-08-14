"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";

import { cn } from "@/lib/utils";

/**
 * Shared scaffolding for the marketing sections, so every one of them has the
 * same max width, vertical rhythm and entrance behaviour.
 *
 * The reveal fires once, at 20% visibility, and is skipped entirely under
 * `prefers-reduced-motion` — content is never gated behind an animation that
 * might not play.
 */

export function Section({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn("relative px-5 py-20 sm:px-8 sm:py-28", className)}>
      <div className="mx-auto w-full max-w-7xl">{children}</div>
    </section>
  );
}

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  if (reduceMotion) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function Eyebrow({ children, icon: Icon }: { children: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-1/70 px-3 py-1 text-xs font-medium text-brand backdrop-blur">
      {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
      {children}
    </span>
  );
}

export function SectionHeading({
  eyebrow,
  eyebrowIcon,
  title,
  description,
  align = "center",
  className,
}: {
  eyebrow?: string;
  eyebrowIcon?: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  align?: "center" | "left";
  className?: string;
}) {
  return (
    <Reveal
      className={cn(
        "flex flex-col gap-4",
        align === "center" ? "items-center text-center" : "items-start text-left",
        className,
      )}
    >
      {eyebrow ? <Eyebrow icon={eyebrowIcon}>{eyebrow}</Eyebrow> : null}
      <h2
        className={cn(
          "text-3xl font-semibold leading-[1.15] tracking-tight text-ink sm:text-4xl lg:text-[2.75rem]",
          align === "center" && "max-w-3xl",
          align === "left" && "max-w-xl",
        )}
      >
        {title}
      </h2>
      {description ? (
        <p
          className={cn(
            "text-base leading-relaxed text-ink-muted sm:text-lg",
            align === "center" ? "max-w-2xl" : "max-w-lg",
          )}
        >
          {description}
        </p>
      ) : null}
    </Reveal>
  );
}

/** Two-column feature layout that stacks below `lg`. */
export function SplitLayout({
  media,
  children,
  reverse = false,
  className,
}: {
  media: React.ReactNode;
  children: React.ReactNode;
  reverse?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("grid items-center gap-10 lg:grid-cols-2 lg:gap-16", className)}>
      <Reveal className={cn("min-w-0", reverse && "lg:order-2")}>{children}</Reveal>
      <Reveal delay={0.1} className={cn("min-w-0", reverse && "lg:order-1")}>
        {media}
      </Reveal>
    </div>
  );
}

/** Bulleted capability list used inside `SplitLayout`. */
export function FeatureList({ items }: { items: Array<{ icon: React.ComponentType<{ className?: string }>; title: string; body: string }> }) {
  return (
    <ul className="mt-8 flex flex-col gap-5">
      {items.map((item) => (
        <li key={item.title} className="flex gap-3.5">
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <item.icon className="size-[1.125rem]" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">{item.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">{item.body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
