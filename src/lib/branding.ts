import { clientEnv } from "@/lib/env";

/**
 * Single source of truth for product identity.
 *
 * Nothing else in the codebase hard-codes the words "TaskFlow HR". Renaming
 * the product is a change to NEXT_PUBLIC_APP_NAME (and this file's defaults),
 * with no component edits.
 */
export const branding = {
  name: clientEnv.NEXT_PUBLIC_APP_NAME,
  /** Short form for tight spaces such as the collapsed sidebar. */
  shortName: clientEnv.NEXT_PUBLIC_APP_NAME.split(" ")[0],
  tagline: clientEnv.NEXT_PUBLIC_APP_TAGLINE,
  description:
    "Manage people, track work and verify attendance by location — in one intelligent workspace.",
  appUrl: clientEnv.NEXT_PUBLIC_APP_URL,
  /** Prefix for per-tenant task references, e.g. TF-118. */
  taskPrefix: "TF",
} as const;

export type Branding = typeof branding;
