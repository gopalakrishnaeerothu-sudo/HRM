import Link from "next/link";
import { Compass } from "lucide-react";

import { branding } from "@/lib/branding";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";

/** Global 404. Also what a cross-tenant id resolves to — see repositories/tenant.ts. */
export default function NotFound() {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center px-5 py-16 text-center">
      <div className="aurora" aria-hidden />

      <Logo className="size-12" />

      <p className="mt-8 text-sm font-medium text-brand">404</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        We couldn&apos;t find that
      </h1>
      <p className="mt-4 max-w-md text-base leading-relaxed text-ink-muted">
        The page may have moved, or the record may no longer exist — or it may belong to a different
        organisation.
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link href="/app">
            <Compass aria-hidden />
            Back to the dashboard
          </Link>
        </Button>
        <Button variant="secondary" asChild>
          <Link href="/">{branding.name} home</Link>
        </Button>
      </div>
    </div>
  );
}
