import Link from "next/link";
import { ArrowLeft, Construction } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageBody, PageHeader } from "@/components/ui/page-header";

/**
 * Placeholder for a module whose architecture exists but whose UI does not.
 *
 * This is used instead of a broken link or a half-built screen: the route is
 * real, it explains exactly what is and isn't there, and it names the schema
 * and service seams a developer would extend. The instruction was to document
 * rather than fake — this is that documentation, in place.
 */
export function PlannedModule({
  title,
  description,
  status,
  foundations,
  backHref = "/app",
  backLabel = "Back to dashboard",
}: {
  title: string;
  description: string;
  /** One line on how far the module currently goes. */
  status: string;
  /** What already exists that this module would build on. */
  foundations: string[];
  backHref?: string;
  backLabel?: string;
}) {
  return (
    <>
      <PageHeader title={title} description={description} />

      <PageBody>
        <Card>
          <CardContent className="flex flex-col items-start gap-6 py-10 sm:flex-row sm:items-center sm:py-12">
            <span
              className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-warning-soft text-warning"
              aria-hidden
            >
              <Construction className="size-7" />
            </span>

            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold tracking-tight text-ink">
                Not built yet — and deliberately not faked
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{status}</p>

              <div className="mt-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                  What already exists
                </p>
                <ul className="mt-2.5 flex flex-col gap-1.5">
                  {foundations.map((item) => (
                    <li key={item} className="flex gap-2 text-sm text-ink-muted">
                      <span className="mt-2 size-1 shrink-0 rounded-full bg-brand" aria-hidden />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <Button variant="secondary" size="sm" className="mt-6" asChild>
                <Link href={backHref}>
                  <ArrowLeft aria-hidden />
                  {backLabel}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}
