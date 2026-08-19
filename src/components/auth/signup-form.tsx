"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Eye, EyeOff, Loader2, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * Request access to an organisation.
 *
 * ─── What this form cannot do ───────────────────────────────────────────────
 * There is no role selector, and there is nothing to add one to: the API
 * schema has no `role` field, so a role posted from a patched client is
 * stripped before any handler sees it. Everyone who signs up arrives as a
 * pending EMPLOYEE and waits for an administrator. That is stated on the form
 * rather than discovered after submitting, because a signup that silently does
 * nothing visible reads as broken.
 */
export function SignupForm() {
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    organizationCode: "",
    password: "",
    confirmPassword: "",
  });

  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ organizationName: string } | null>(null);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((previous) => ({ ...previous, [key]: value }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});

    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            data?: { organizationName?: string };
            error?: { message?: string; details?: Record<string, string[]> };
          }
        | null;

      if (!response.ok) {
        setFieldErrors(payload?.error?.details ?? {});
        setFormError(payload?.error?.message ?? "Could not send your request. Please try again.");
        return;
      }

      setSubmitted({ organizationName: payload?.data?.organizationName ?? "your organisation" });
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // The confirmation deliberately does not say whether a new account was
  // created — an address that already has one produces this same screen, so
  // the form cannot be used to find out who works here.
  if (submitted) {
    return (
      <div className="mt-8 flex flex-col items-center gap-4 text-center" role="status">
        <span className="flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
          <CheckCircle2 className="size-6" aria-hidden />
        </span>

        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Request sent</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-secondary">
            An administrator at {submitted.organizationName} needs to approve your account before
            you can sign in. You&rsquo;ll be able to sign in once they do.
          </p>
        </div>

        <Button asChild variant="secondary" className="mt-2 w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
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

      <Field label="Full name" required error={fieldErrors.fullName?.[0] ?? null}>
        {(control) => (
          <Input
            {...control}
            name="fullName"
            autoComplete="name"
            autoFocus
            placeholder="Gopala Krishna"
            value={form.fullName}
            disabled={submitting}
            onChange={(event) => update("fullName", event.target.value)}
          />
        )}
      </Field>

      <Field label="Work email" required error={fieldErrors.email?.[0] ?? null}>
        {(control) => (
          <Input
            {...control}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            placeholder="you@company.com"
            value={form.email}
            disabled={submitting}
            onChange={(event) => update("email", event.target.value)}
          />
        )}
      </Field>

      <Field label="Phone number" required error={fieldErrors.phone?.[0] ?? null}>
        {(control) => (
          <Input
            {...control}
            type="tel"
            name="phone"
            autoComplete="tel"
            inputMode="tel"
            placeholder="+91 98765 43210"
            value={form.phone}
            disabled={submitting}
            onChange={(event) => update("phone", event.target.value)}
          />
        )}
      </Field>

      <Field
        label="Organisation code"
        required
        error={fieldErrors.organizationCode?.[0] ?? null}
        hint="The code your administrator shared with you."
      >
        {(control) => (
          <Input
            {...control}
            name="organizationCode"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="BCDFGHJK23"
            className="font-mono tracking-[0.2em] uppercase"
            value={form.organizationCode}
            disabled={submitting}
            onChange={(event) => update("organizationCode", event.target.value)}
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
              autoComplete="new-password"
              placeholder="At least 12 characters"
              className="pr-11"
              value={form.password}
              disabled={submitting}
              onChange={(event) => update("password", event.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              tabIndex={-1}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-1 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        )}
      </Field>

      <Field label="Confirm password" required error={fieldErrors.confirmPassword?.[0] ?? null}>
        {(control) => (
          <Input
            {...control}
            type={showPassword ? "text" : "password"}
            name="confirmPassword"
            autoComplete="new-password"
            placeholder="Re-enter your password"
            value={form.confirmPassword}
            disabled={submitting}
            onChange={(event) => update("confirmPassword", event.target.value)}
          />
        )}
      </Field>

      <p className="rounded-xl border border-hairline bg-surface-sunken/60 px-4 py-3 text-xs leading-relaxed text-ink-muted">
        Your request goes to your organisation&rsquo;s administrator. You&rsquo;ll be able to sign
        in once they approve it and assign your role.
      </p>

      <Button type="submit" size="lg" disabled={submitting} className="mt-1 w-full">
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Sending request…
          </>
        ) : (
          <>
            <UserPlus className="size-4" aria-hidden />
            Request access
          </>
        )}
      </Button>
    </form>
  );
}
