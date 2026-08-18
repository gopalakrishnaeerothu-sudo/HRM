import Link from "next/link";
import { Database, KeyRound, Terminal } from "lucide-react";

import { branding } from "@/lib/branding";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Shown when `/app` is opened with no resolvable session.
 *
 * This is the authentication seam made visible rather than papered over. There
 * is deliberately no fake sign-in form: a form that accepts any password would
 * be worse than none, because it would look like security. Instead this
 * explains exactly which of the two possible causes applies and what to do.
 */
export function NoSessionScreen({ devAuthAvailable }: { devAuthAvailable: boolean }) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center px-5 py-16">
      <div className="aurora" aria-hidden />

      <Card className="w-full max-w-xl">
        <CardContent className="p-8 sm:p-10">
          <Logo className="size-11" />

          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-ink">
            No session available
          </h1>

          <p className="mt-3 text-sm leading-relaxed text-ink-secondary">
            {devAuthAvailable
              ? `${branding.name} has no authentication provider registered yet. In development you can browse the workspace as a seeded user; production requires a real provider.`
              : `${branding.name} has no authentication provider registered for this deployment. Sign-in is unavailable until one is configured.`}
          </p>

          <div className="mt-7 flex flex-col gap-4">
            {devAuthAvailable ? (
              <>
                <Step
                  icon={Database}
                  title="1 · Create and seed the database"
                  body="Point DATABASE_URL at a local PostgreSQL instance, then run the migration and seed."
                  code={"npm run db:migrate\nnpm run db:seed"}
                />
                <Step
                  icon={Terminal}
                  title="2 · Enable the development adapter"
                  body="Set DEV_AUTH_ENABLED=true in .env and restart. You will land on the seeded owner account, and the flask icon in the top bar switches between roles."
                  code={'DEV_AUTH_ENABLED="true"'}
                />
              </>
            ) : null}

            <Step
              icon={KeyRound}
              title={devAuthAvailable ? "For production" : "To enable sign-in"}
              body="Implement the AuthAdapter interface — email/password, phone OTP, Google, Microsoft or SSO — and register it in src/server/auth/index.ts. Nothing outside that folder needs to change."
              code="src/server/auth/index.ts → resolveAdapter()"
            />
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button variant="secondary" asChild>
              <Link href="/">Back to the landing page</Link>
            </Button>
            <Button variant="ghost" asChild>
              <Link href="/api/health">Check service health</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Step({
  icon: Icon,
  title,
  body,
  code,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  code: string;
}) {
  return (
    <div className="flex gap-3.5 rounded-xl border border-line bg-surface-2/50 p-4">
      <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
        <Icon className="size-[1.125rem]" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">{body}</p>
        <pre className="mt-2.5 overflow-x-auto rounded-lg bg-surface-3/70 px-3 py-2 font-mono text-[0.6875rem] leading-relaxed text-ink-secondary">
          {code}
        </pre>
      </div>
    </div>
  );
}
