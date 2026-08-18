import { redirect } from "next/navigation";

import { branding } from "@/lib/branding";
import { getSession } from "@/server/auth";
import { Logo } from "@/components/brand/logo";
import { Card, CardContent } from "@/components/ui/card";
import { SignInForm } from "@/components/auth/sign-in-form";

/**
 * Sign-in page.
 *
 * Resolves the session server-side first, so following a stale bookmark while
 * already signed in lands in the app rather than on a form that then has to
 * bounce.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: `Sign in · ${branding.name}`,
  robots: { index: false, follow: false },
};

/**
 * Only same-origin absolute paths are honoured.
 *
 * `?next=` comes from the URL bar, so it is attacker-controlled. Without this
 * check, a link to `/login?next=https://evil.example` would hand someone a
 * genuine sign-in on this domain that then deposits them somewhere else —
 * a phishing hop with our name on it. `//host` is rejected too: the browser
 * reads it as protocol-relative and treats it as another origin.
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
  const [session, { next }] = await Promise.all([getSession(), searchParams]);
  const redirectTo = safeRedirect(next);

  if (session) redirect(redirectTo);

  return (
    <div className="relative flex min-h-dvh items-center justify-center px-5 py-16">
      <div className="aurora" aria-hidden />

      <Card className="w-full max-w-md">
        <CardContent className="p-8 sm:p-10">
          <Logo className="size-11" />

          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-ink">Sign in</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
            Welcome back to {branding.name}.
          </p>

          <SignInForm redirectTo={redirectTo} />
        </CardContent>
      </Card>
    </div>
  );
}
