"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Eye, EyeOff, Loader2, LogIn } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * Sign-in form.
 *
 * The server decides everything that matters. In particular this does not try
 * to distinguish "no such account" from "wrong password" — the API
 * deliberately does not tell it, because that difference is what turns a leaked
 * address list into a confirmed one.
 */
export function LoginForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
      const response = await fetch("/api/auth/login", {
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
        setPassword("");
        return;
      }

      // `refresh` matters as much as `push`: the app shell is a server
      // component that already rendered as signed out, and would otherwise be
      // served from the client router cache in that state.
      router.push(redirectTo);
      router.refresh();
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-8 flex flex-col gap-4">
      {formError ? (
        <p
          role="alert"
          aria-live="polite"
          className="rounded-xl border border-critical/30 bg-critical/10 px-4 py-3 text-sm leading-relaxed text-critical"
        >
          {formError}
        </p>
      ) : null}

      <Field label="Work email" required error={fieldErrors.email?.[0] ?? null}>
        {(control) => (
          <Input
            {...control}
            type="email"
            name="email"
            autoComplete="email"
            autoFocus
            inputMode="email"
            placeholder="you@company.com"
            value={email}
            disabled={submitting}
            onChange={(event) => setEmail(event.target.value)}
          />
        )}
      </Field>

      <Field label="Password" required error={fieldErrors.password?.[0] ?? null}>
        {(control) => (
          <div className="relative">
            <Input
              {...control}
              type={showPassword ? "text" : "password"}
              name="password"
              autoComplete="current-password"
              placeholder="••••••••••••"
              className="pr-11"
              value={password}
              disabled={submitting}
              onChange={(event) => setPassword(event.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              // Tab order skips it: it is a convenience for pointer users, and
              // keyboard users reaching it between password and submit is a
              // trap rather than a help.
              tabIndex={-1}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        )}
      </Field>

      <Button type="submit" size="lg" disabled={submitting} className="mt-2 w-full">
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Signing in…
          </>
        ) : (
          <>
            <LogIn className="size-4" aria-hidden />
            Sign in
          </>
        )}
      </Button>
    </form>
  );
}
