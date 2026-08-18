"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * Sign-in form.
 *
 * The server decides everything that matters; this only collects two strings
 * and reports back what the server said. In particular it does not try to
 * distinguish "no such account" from "wrong password" — the API deliberately
 * does not tell it, because that difference enumerates users.
 */
export function SignInForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    try {
      const response = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string; details?: Record<string, string[]> } }
          | null;

        setFieldErrors(payload?.error?.details ?? {});
        setFormError(payload?.error?.message ?? "Sign-in failed. Please try again.");
        return;
      }

      // `refresh` matters as much as `push`: the app shell is a server
      // component that already rendered without a session, and would otherwise
      // be served from the client router cache as if still signed out.
      router.push(redirectTo);
      router.refresh();
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-7 flex flex-col gap-4">
      {formError ? (
        <p
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger"
        >
          {formError}
        </p>
      ) : null}

      <Field label="Email" required error={fieldErrors.email?.[0] ?? null}>
        {(control) => (
          <Input
            {...control}
            type="email"
            name="email"
            autoComplete="email"
            autoFocus
            placeholder="you@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        )}
      </Field>

      <Field label="Password" required error={fieldErrors.password?.[0] ?? null}>
        {(control) => (
          <Input
            {...control}
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        )}
      </Field>

      <Button type="submit" disabled={submitting} className="mt-1 w-full">
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Signing in…
          </>
        ) : (
          "Sign in"
        )}
      </Button>
    </form>
  );
}
