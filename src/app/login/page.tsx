import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";

import { branding } from "@/lib/branding";
import { getSession } from "@/server/auth";
import { Logo } from "@/components/brand/logo";
import { Card, CardContent } from "@/components/ui/card";
import { LoginForm } from "@/components/auth/login-form";

/**
 * Sign-in page.
 *
 * Resolves the session server-side first, so following a stale bookmark while
 * already signed in lands in the app rather than on a form that then has to
 * bounce the user onwards.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Sign in · ${branding.name}`,
  // A sign-in page in a search index is noise at best; at worst it is a
  // starting point for someone enumerating the deployment.
  robots: { index: false, follow: false },
};

/**
 * Only same-origin absolute paths are honoured.
 *
 * `?next=` comes from the URL bar, so it is attacker-controlled. Without this,
 * `/login?next=https://evil.example` would be a genuine sign-in on this
 * domain that deposits the user somewhere else afterwards — a phishing hop
 * wearing our name. `//host` is rejected too: a browser reads it as
 * protocol-relative, so it is another origin despite the leading slash.
 */
function safeRedirect(next: string | undefined): string {
  if (!next) return "/app";
  if (!next.startsWith("/") || next.startsWith("//")) return "/app";
  return next;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [session, params] = await Promise.all([getSession(), searchParams]);
  const redirectTo = safeRedirect(params.next);

  if (session) redirect(redirectTo);

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-5 py-16">
      <div className="aurora" aria-hidden />

      <div className="w-full max-w-md">
        <Card className="glass-panel">
          <CardContent className="p-8 sm:p-10">
            <Logo className="size-11" />

            <h1 className="mt-7 text-2xl font-semibold tracking-tight text-ink">
              Sign in to {branding.name}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
              Manage your people, tasks and attendance in one workspace.
            </p>

            <LoginForm redirectTo={redirectTo} />
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs leading-relaxed text-ink-muted">
          Trouble signing in? Ask an administrator to reset your password.
          <br />
          <Link
            href="/"
            className="mt-1 inline-block underline-offset-4 transition-colors hover:text-ink-secondary hover:underline"
          >
            Back to {branding.name}
          </Link>
        </p>
      </div>
    </main>
  );
}
