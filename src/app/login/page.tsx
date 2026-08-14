import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { branding } from "@/lib/branding";
import { isProduction, serverEnv } from "@/lib/env";
import { getSession } from "@/server/auth";
import { safeRedirect } from "@/lib/validation/auth";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { LoginForm, LoginHero } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: `Sign in to ${branding.name}.`,
  robots: { index: false, follow: false },
};

/**
 * Sign-in page.
 *
 * Already-authenticated visitors are redirected away server-side, so the login
 * form is never rendered to someone who has a session — that avoids the
 * confusing state where signing in again silently rotates your session.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; expired?: string }>;
}) {
  const session = await getSession();
  const { next } = await searchParams;

  if (session) {
    redirect(safeRedirect(next));
  }

  const devAuthActive = !isProduction && serverEnv().DEV_AUTH_ENABLED;

  return (
    <div className="relative flex min-h-dvh flex-col">
      <div className="aurora" aria-hidden />
      <div className="absolute inset-0 -z-10 grid-backdrop opacity-50" aria-hidden />

      <header className="flex items-center justify-between px-5 py-5 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        >
          <Logo className="size-8" />
          <span className="text-[0.9375rem] font-semibold tracking-tight text-ink">
            {branding.name}
          </span>
        </Link>
        <ThemeToggle />
      </header>

      <main
        id="main-content"
        className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8"
      >
        <div className="grid w-full max-w-5xl items-center gap-12 lg:grid-cols-2 lg:gap-16">
          {/* Hidden on small screens: on a phone the form should be the only
              thing competing for attention. */}
          <LoginHero className="hidden lg:block" />

          <div className="flex justify-center lg:justify-end">
            <Suspense fallback={<Skeleton className="h-[28rem] w-full max-w-md rounded-xl" />}>
              <LoginForm />
            </Suspense>
          </div>
        </div>
      </main>

      <footer className="px-5 pb-8 text-center sm:px-8">
        {devAuthActive ? (
          <p className="mx-auto max-w-md rounded-xl border border-warning/30 bg-warning-soft/50 px-4 py-2.5 text-xs leading-relaxed text-ink-secondary">
            <strong className="font-semibold">Development mode.</strong> Impersonation is enabled,
            so this form is optional here. It is refused entirely in production.
          </p>
        ) : (
          <p className="text-xs text-ink-muted">
            Protected by session authentication. Contact your administrator for access.
          </p>
        )}
      </footer>
    </div>
  );
}

export const dynamic = "force-dynamic";
