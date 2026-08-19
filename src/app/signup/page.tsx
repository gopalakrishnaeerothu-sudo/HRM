import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";

import { branding } from "@/lib/branding";
import { getSession } from "@/server/auth";
import { Logo } from "@/components/brand/logo";
import { Card, CardContent } from "@/components/ui/card";
import { SignupForm } from "@/components/auth/signup-form";

/**
 * Request access.
 *
 * Mirrors the sign-in page: session resolved server-side first, so somebody
 * already signed in who follows this link lands in the app rather than being
 * offered a second account.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Request access · ${branding.name}`,
  // Same reasoning as the sign-in page, and a little stronger: an indexed
  // signup form invites automated submissions into every tenant's queue.
  robots: { index: false, follow: false },
};

export default async function SignupPage() {
  if (await getSession()) redirect("/app");

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-5 py-16">
      <div className="aurora" aria-hidden />

      <div className="w-full max-w-md">
        <Card className="glass-panel">
          <CardContent className="p-8 sm:p-10">
            <Logo className="size-11" />

            <h1 className="mt-7 text-2xl font-semibold tracking-tight text-ink">
              Request access to {branding.name}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
              Already have an account?{" "}
              <Link
                href="/login"
                className="font-medium text-brand underline-offset-4 transition-colors hover:underline"
              >
                Sign in
              </Link>
            </p>

            <SignupForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
