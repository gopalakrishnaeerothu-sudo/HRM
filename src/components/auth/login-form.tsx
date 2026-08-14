"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { AlertCircle, ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";

import { branding } from "@/lib/branding";
import { cn } from "@/lib/utils";
import { loginSchema } from "@/lib/validation/auth";
import { fieldErrors } from "@/lib/validation/common";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * Sign-in form.
 *
 * A few decisions worth stating:
 *
 * · The error message for a wrong password and for an unknown email is the
 *   same string, because the server deliberately does not distinguish them.
 *   Showing "no such account" here would undo that.
 *
 * · The form posts to `/api/auth/login` and then navigates with
 *   `router.replace`, so the browser's back button cannot return to a
 *   pre-login state. `router.refresh()` re-runs the server layout so the shell
 *   picks up the new session.
 *
 * · No token is ever read or written by this component. The session lives in
 *   an HttpOnly cookie the browser cannot see, which is what makes an XSS bug
 *   short of full account takeover.
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reduceMotion = useReducedMotion();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const redirectTo = searchParams.get("next") ?? undefined;
  // Set when a server-side guard bounced someone here from a protected route.
  const expired = searchParams.get("expired") === "1";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrors({});
    setFormError(null);

    const payload = { email: email.trim(), password, redirectTo };

    const parsed = loginSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();

      if (!response.ok) {
        if (body?.error?.details) setErrors(body.error.details);

        const retryAfter = body?.error?.meta?.retryAfterSeconds;
        setFormError(
          typeof retryAfter === "number"
            ? `Too many attempts. Try again in ${Math.ceil(retryAfter / 60)} minute${Math.ceil(retryAfter / 60) === 1 ? "" : "s"}.`
            : (body?.error?.message ?? "Couldn't sign you in."),
        );
        return;
      }

      // replace, not push: the login page must not be reachable via Back.
      router.replace(body.data.redirectTo ?? "/app");
      router.refresh();
    } catch {
      setFormError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const rise = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 16 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] as const },
        };

  return (
    <motion.form
      onSubmit={submit}
      noValidate
      {...rise(0.1)}
      className="glass-card w-full max-w-md p-6 sm:p-8"
    >
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Sign in</h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        Welcome back to {branding.name}.
      </p>

      {expired ? (
        <div
          role="status"
          className="mt-5 flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning-soft/50 px-3.5 py-3"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p className="text-xs leading-relaxed text-ink-secondary">
            Your session ended. Sign in again to continue where you left off.
          </p>
        </div>
      ) : null}

      {formError ? (
        <div
          role="alert"
          className="mt-5 flex items-start gap-2.5 rounded-xl border border-critical/30 bg-critical-soft/60 px-3.5 py-3"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-critical" aria-hidden />
          <p className="text-sm leading-relaxed text-ink">{formError}</p>
        </div>
      ) : null}

      <div className="mt-6 flex flex-col gap-5">
        <Field label="Work email" required error={errors.email?.[0]}>
          {(control) => (
            <Input
              {...control}
              type="email"
              inputMode="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              leadingIcon={<Mail />}
              disabled={submitting}
            />
          )}
        </Field>

        <Field label="Password" required error={errors.password?.[0]}>
          {(control) => (
            <div className="relative">
              <Input
                {...control}
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••••••"
                leadingIcon={<Lock />}
                disabled={submitting}
                className="pr-11"
              />
              <button
                type="button"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              >
                {showPassword ? (
                  <EyeOff className="size-4" aria-hidden />
                ) : (
                  <Eye className="size-4" aria-hidden />
                )}
              </button>
            </div>
          )}
        </Field>
      </div>

      <Button type="submit" size="lg" block className="mt-7" loading={submitting}>
        Sign in
        {!submitting ? <ArrowRight className="size-4" aria-hidden /> : null}
      </Button>

      {/* Recovery is not self-service yet — say so plainly rather than linking
          to a page that does not exist. */}
      <p className="mt-5 text-center text-xs leading-relaxed text-ink-muted">
        Forgotten your password? Self-service reset isn&apos;t available yet — ask an
        administrator to set a new one for you.
      </p>
    </motion.form>
  );
}

/** Branding panel beside the form on wide screens. */
export function LoginHero({ className }: { className?: string }) {
  const reduceMotion = useReducedMotion();

  const points = [
    "Location-verified attendance",
    "Tasks, teams and workload in one board",
    "Role-based access, audited end to end",
  ];

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className={cn("max-w-md", className)}
    >
      <h2 className="text-3xl font-semibold leading-tight tracking-tight text-ink lg:text-4xl">
        One workspace for your{" "}
        <span className="text-gradient">people, tasks and attendance.</span>
      </h2>

      <ul className="mt-8 flex flex-col gap-3.5">
        {points.map((point) => (
          <li key={point} className="flex items-center gap-3 text-sm text-ink-secondary">
            <span
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand"
              aria-hidden
            >
              <svg viewBox="0 0 16 16" className="size-3.5" fill="none">
                <path
                  d="M3.5 8.5l3 3 6-7"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            {point}
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
