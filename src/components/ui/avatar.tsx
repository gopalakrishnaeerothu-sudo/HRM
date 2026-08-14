"use client";

import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";

import { cn, hashToIndex, initials } from "@/lib/utils";

/**
 * Avatars fall back to initials on a deterministic tinted background, so a
 * person keeps the same colour everywhere in the product even without a photo.
 */

const FALLBACK_TINTS = [
  "bg-[color-mix(in_srgb,var(--series-1)_18%,transparent)] text-[var(--series-1)]",
  "bg-[color-mix(in_srgb,var(--series-2)_18%,transparent)] text-[var(--series-2)]",
  "bg-[color-mix(in_srgb,var(--series-3)_18%,transparent)] text-[var(--series-3)]",
  "bg-[color-mix(in_srgb,var(--series-5)_18%,transparent)] text-[var(--series-5)]",
  "bg-[color-mix(in_srgb,var(--series-7)_18%,transparent)] text-[var(--series-7)]",
  "bg-[color-mix(in_srgb,var(--brand)_18%,transparent)] text-brand",
] as const;

const sizeClasses = {
  xs: "size-6 text-[0.625rem]",
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-12 text-base",
  xl: "size-16 text-xl",
  "2xl": "size-24 text-3xl",
} as const;

export type AvatarSize = keyof typeof sizeClasses;

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: AvatarSize;
  className?: string;
  /** Adds a ring in the surface colour — used when avatars overlap. */
  ringed?: boolean;
}

export function Avatar({ name, src, size = "md", className, ringed = false }: AvatarProps) {
  const tint = FALLBACK_TINTS[hashToIndex(name, FALLBACK_TINTS.length)];

  return (
    <AvatarPrimitive.Root
      className={cn(
        "relative flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full",
        sizeClasses[size],
        ringed && "ring-2 ring-surface-1",
        className,
      )}
    >
      {src ? (
        <AvatarPrimitive.Image
          src={src}
          alt=""
          className="aspect-square size-full object-cover"
          /* alt is empty because the adjacent name text is the accessible label */
        />
      ) : null}
      <AvatarPrimitive.Fallback
        delayMs={src ? 300 : 0}
        className={cn("flex size-full items-center justify-center font-semibold", tint)}
      >
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

/** Overlapping stack with a "+N" overflow chip. Used for team and task rosters. */
export function AvatarGroup({
  people,
  max = 4,
  size = "sm",
  className,
}: {
  people: Array<{ id: string; name: string; avatarUrl?: string | null }>;
  max?: number;
  size?: AvatarSize;
  className?: string;
}) {
  const visible = people.slice(0, max);
  const overflow = people.length - visible.length;

  return (
    <div className={cn("flex items-center", className)}>
      <div className="flex -space-x-2">
        {visible.map((person) => (
          <Avatar key={person.id} name={person.name} src={person.avatarUrl} size={size} ringed />
        ))}
        {overflow > 0 ? (
          <span
            className={cn(
              "relative z-10 flex items-center justify-center rounded-full bg-surface-3 font-semibold text-ink-secondary ring-2 ring-surface-1",
              sizeClasses[size],
            )}
          >
            +{overflow}
          </span>
        ) : null}
      </div>
      <span className="sr-only">
        {people.map((person) => person.name).join(", ") || "No one assigned"}
      </span>
    </div>
  );
}
