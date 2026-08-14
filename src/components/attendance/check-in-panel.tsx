"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  Coffee,
  LocateFixed,
  LogIn,
  LogOut,
  MapPin,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { toast } from "sonner";

import { cn, formatDistance, formatMinutes } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The employee check-in surface.
 *
 * What this component does NOT do is decide anything. It reads the browser's
 * geolocation and posts the raw coordinates; the "you're inside the office"
 * indicator is the *server's* answer echoed back from
 * `/api/attendance/verify-location`. There is no client-side distance
 * calculation anywhere in this file, deliberately — if there were, someone
 * would eventually trust it.
 */

type Verdict = {
  allowed: boolean;
  verification: string;
  message: string;
  officeName: string | null;
  distanceMeters: number | null;
  requiredRadiusMeters: number | null;
  riskFlags: string[];
};

type GeoState =
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "denied"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "checking" }
  | { kind: "resolved"; verdict: Verdict };

export interface CheckInPanelProps {
  officeName: string | null;
  isCheckedIn: boolean;
  isCheckedOut: boolean;
  onBreak: boolean;
  workedMinutes: number;
  checkInLabel: string | null;
  checkOutLabel: string | null;
  hasAssignedOffice: boolean;
}

async function readPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      // 12s is long enough for a cold GPS fix without stranding the UI.
      timeout: 12_000,
      // Never reuse a cached fix: the whole point is where you are *now*.
      maximumAge: 0,
    });
  });
}

function locationClaim(position: GeolocationPosition) {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyMeters: position.coords.accuracy,
    capturedAt: new Date(position.timestamp).toISOString(),
  };
}

function describeGeolocationError(error: GeolocationPositionError): { kind: "denied" | "unavailable"; message: string } {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return {
        kind: "denied",
        message:
          "Location access is blocked. Allow it for this site in your browser settings, then try again.",
      };
    case error.POSITION_UNAVAILABLE:
      return { kind: "unavailable", message: "Your device couldn't determine a location right now." };
    case error.TIMEOUT:
      return { kind: "unavailable", message: "Getting your location took too long. Try again." };
    default:
      return { kind: "unavailable", message: "We couldn't read your location." };
  }
}

export function CheckInPanel(props: CheckInPanelProps) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const [state, setState] = React.useState<GeoState>({ kind: "idle" });
  const [submitting, setSubmitting] = React.useState(false);

  const verify = React.useCallback(async () => {
    if (!("geolocation" in navigator)) {
      setState({ kind: "unavailable", message: "This browser doesn't support location services." });
      return;
    }

    setState({ kind: "locating" });
    try {
      const position = await readPosition();
      setState({ kind: "checking" });

      const response = await fetch("/api/attendance/verify-location", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ location: locationClaim(position) }),
      });

      const payload = await response.json();
      if (!response.ok) {
        setState({
          kind: "unavailable",
          message: payload?.error?.message ?? "We couldn't verify your location.",
        });
        return;
      }

      setState({ kind: "resolved", verdict: payload.data as Verdict });
    } catch (error) {
      if (error instanceof GeolocationPositionError || (error as GeolocationPositionError)?.code !== undefined) {
        const described = describeGeolocationError(error as GeolocationPositionError);
        setState({ kind: described.kind, message: described.message });
        return;
      }
      setState({ kind: "unavailable", message: "We couldn't verify your location." });
    }
  }, []);

  // Verify on mount, but only when a check-in is actually possible.
  React.useEffect(() => {
    if (props.isCheckedOut || !props.hasAssignedOffice) return;
    void verify();
  }, [verify, props.isCheckedOut, props.hasAssignedOffice]);

  const submit = async (action: "check-in" | "check-out") => {
    setSubmitting(true);
    try {
      let body: Record<string, unknown> = {};

      if (action === "check-in") {
        const position = await readPosition();
        body = { location: locationClaim(position) };
      } else {
        // Check-out sends a location when one is available; the server decides
        // whether it is required.
        try {
          const position = await readPosition();
          body = { location: locationClaim(position) };
        } catch {
          body = {};
        }
      }

      const response = await fetch(`/api/attendance/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();

      if (!response.ok) {
        const meta = payload?.error?.meta ?? {};
        toast.error(payload?.error?.message ?? "That didn't work", {
          description:
            typeof meta.distanceMeters === "number" && typeof meta.requiredRadiusMeters === "number"
              ? `You are ${formatDistance(meta.distanceMeters)} from ${meta.officeName ?? "the office"} — the perimeter is ${meta.requiredRadiusMeters} m.`
              : undefined,
        });
        await verify();
        return;
      }

      toast.success(payload.data.message);
      router.refresh();
    } catch (error) {
      const described =
        (error as GeolocationPositionError)?.code !== undefined
          ? describeGeolocationError(error as GeolocationPositionError)
          : { message: "Something went wrong. Try again." };
      toast.error("Couldn't record attendance", { description: described.message });
    } finally {
      setSubmitting(false);
    }
  };

  const toggleBreak = async () => {
    setSubmitting(true);
    try {
      const response = await fetch("/api/attendance/break", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: props.onBreak ? "end" : "start" }),
      });
      const payload = await response.json();
      if (!response.ok) {
        toast.error(payload?.error?.message ?? "Couldn't update your break");
        return;
      }
      toast.success(props.onBreak ? "Break ended" : "Break started");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const verdict = state.kind === "resolved" ? state.verdict : null;
  const inside = verdict?.allowed === true;

  return (
    <Card className="overflow-hidden">
      {/* The status band is the first thing read; it states the verdict in
          words, with colour and icon as reinforcement. */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-3 border-b border-line px-5 py-4 sm:px-6",
          inside
            ? "bg-success-soft/70"
            : verdict
              ? "bg-critical-soft/70"
              : "bg-surface-2/60",
        )}
      >
        <StatusIcon state={state} inside={inside} reduceMotion={Boolean(reduceMotion)} />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{headline(state, props)}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-secondary">{detail(state, props)}</p>
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={verify}
          disabled={state.kind === "locating" || state.kind === "checking"}
          aria-label="Re-check my location"
        >
          <RefreshCw
            className={cn(
              "size-4",
              (state.kind === "locating" || state.kind === "checking") && "animate-spin",
            )}
            aria-hidden
          />
        </Button>
      </div>

      <CardContent className="pt-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-ink-muted">Worked today</p>
            <p className="mt-0.5 text-3xl font-semibold tracking-tight tabular text-ink">
              {formatMinutes(props.workedMinutes)}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {props.checkInLabel ? (
                <Badge tone="outline" size="sm">
                  <LogIn aria-hidden />
                  In {props.checkInLabel}
                </Badge>
              ) : null}
              {props.checkOutLabel ? (
                <Badge tone="outline" size="sm">
                  <LogOut aria-hidden />
                  Out {props.checkOutLabel}
                </Badge>
              ) : null}
              {props.onBreak ? (
                <Badge tone="warning" size="sm">
                  <Coffee aria-hidden />
                  On break
                </Badge>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {props.isCheckedOut ? (
              <Button disabled variant="secondary">
                Day complete
              </Button>
            ) : props.isCheckedIn ? (
              <>
                <Button variant="secondary" onClick={toggleBreak} loading={submitting}>
                  <Coffee aria-hidden />
                  {props.onBreak ? "End break" : "Take a break"}
                </Button>
                <Button onClick={() => submit("check-out")} loading={submitting}>
                  <LogOut aria-hidden />
                  Check out
                </Button>
              </>
            ) : (
              <Button
                size="lg"
                onClick={() => submit("check-in")}
                loading={submitting}
                // Disabled only when the server has said no — never on a
                // client-side guess about where the user is.
                disabled={!props.hasAssignedOffice || (verdict !== null && !verdict.allowed)}
              >
                <LogIn aria-hidden />
                Check in
              </Button>
            )}
          </div>
        </div>

        {verdict && !verdict.allowed && verdict.distanceMeters !== null ? (
          <div className="mt-5 rounded-xl border border-critical/25 bg-critical-soft/50 p-4">
            <p className="text-sm font-semibold text-critical">Access denied</p>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">
              You&apos;re currently outside your assigned office location.
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <dt className="text-[0.6875rem] text-ink-muted">Distance from office</dt>
                <dd className="mt-0.5 text-base font-semibold tabular text-ink">
                  {formatDistance(verdict.distanceMeters)}
                </dd>
              </div>
              <div>
                <dt className="text-[0.6875rem] text-ink-muted">Required radius</dt>
                <dd className="mt-0.5 text-base font-semibold tabular text-ink">
                  {verdict.requiredRadiusMeters ?? "—"} m
                </dd>
              </div>
            </dl>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StatusIcon({
  state,
  inside,
  reduceMotion,
}: {
  state: GeoState;
  inside: boolean;
  reduceMotion: boolean;
}) {
  const locating = state.kind === "locating" || state.kind === "checking";

  const Icon = locating
    ? LocateFixed
    : state.kind === "denied" || state.kind === "unavailable"
      ? ShieldAlert
      : inside
        ? ShieldCheck
        : state.kind === "resolved"
          ? ShieldX
          : MapPin;

  return (
    <span className="relative flex size-10 shrink-0 items-center justify-center" aria-hidden>
      {inside && !reduceMotion ? (
        <motion.span
          className="absolute inset-0 rounded-full bg-success/25"
          animate={{ scale: [1, 1.5], opacity: [0.6, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeOut" }}
        />
      ) : null}
      <span
        className={cn(
          "relative flex size-10 items-center justify-center rounded-full",
          inside
            ? "bg-success text-white"
            : state.kind === "resolved"
              ? "bg-critical text-white"
              : "bg-surface-3 text-ink-secondary",
        )}
      >
        <Icon className={cn("size-5", locating && "animate-pulse")} />
      </span>
    </span>
  );
}

function headline(state: GeoState, props: CheckInPanelProps): string {
  if (!props.hasAssignedOffice) return "No office assigned";
  if (props.isCheckedOut) return "Today is complete";

  switch (state.kind) {
    case "idle":
      return "Checking your location…";
    case "locating":
      return "Finding your location…";
    case "checking":
      return "Verifying with the server…";
    case "denied":
      return "Location access blocked";
    case "unavailable":
      return "Location unavailable";
    case "resolved":
      return state.verdict.allowed
        ? `You're inside ${state.verdict.officeName ?? "the office"}`
        : "You're outside the office perimeter";
  }
}

function detail(state: GeoState, props: CheckInPanelProps): string {
  if (!props.hasAssignedOffice) {
    return "Ask your HR team to assign you to an office before checking in.";
  }
  if (props.isCheckedOut) return "Attendance for today has been recorded.";

  switch (state.kind) {
    case "denied":
    case "unavailable":
      return state.message;
    case "resolved":
      return state.verdict.distanceMeters !== null
        ? `${formatDistance(state.verdict.distanceMeters)} from the centre · verified server-side`
        : state.verdict.message;
    default:
      return "Your coordinates are checked against your office perimeter on the server.";
  }
}
