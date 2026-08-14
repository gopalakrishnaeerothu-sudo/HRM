import type { Metadata } from "next";

import { branding } from "@/lib/branding";
import { Hero } from "@/components/landing/hero";
import { ProductPreview } from "@/components/landing/product-preview";
import { GeofenceSection } from "@/components/landing/geofence-demo";
import {
  AnalyticsSection,
  AttendanceSection,
  TasksSection,
  TeamsSection,
} from "@/components/landing/feature-sections";
import { FinalCta } from "@/components/landing/final-cta";

export const metadata: Metadata = {
  title: `${branding.name} — ${branding.tagline}`,
  description: branding.description,
};

/**
 * Landing page.
 *
 * A Server Component that composes client sections, so only the interactive
 * pieces ship JavaScript. The 3D hero is behind a further dynamic import
 * inside `HeroVisual`, which means three.js is never fetched on a phone or on
 * a machine without WebGL.
 */
export default function LandingPage() {
  return (
    <>
      <Hero />
      <ProductPreview />
      <GeofenceSection />
      <TasksSection />
      <AttendanceSection />
      <TeamsSection />
      <AnalyticsSection />
      <FinalCta />
    </>
  );
}
