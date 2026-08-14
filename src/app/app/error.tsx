"use client";

import * as React from "react";

import { ErrorState } from "@/components/ui/states";
import { Card } from "@/components/ui/card";

/**
 * Error boundary for the whole `/app` subtree.
 *
 * Shows a human sentence, never the thrown message — a Prisma error can carry
 * a connection string or row contents. The real detail is logged server-side;
 * the digest is the only identifier surfaced, so a user can quote it in a
 * support request without anything sensitive being exposed.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("[app] render error", error);
  }, [error]);

  return (
    <Card className="mt-6">
      <ErrorState
        size="page"
        title="This page couldn't load"
        description="Something went wrong on our end. The issue has been logged and you can try again."
        onRetry={reset}
      />
      {error.digest ? (
        <p className="pb-6 text-center font-mono text-[0.6875rem] text-ink-muted">
          Reference: {error.digest}
        </p>
      ) : null}
    </Card>
  );
}
