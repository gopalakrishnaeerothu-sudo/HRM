"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, CalendarPlus, Plane, X } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { formatDate, formatRelative } from "@/lib/time";
import { LEAVE_TYPE_LABELS, requestLeaveSchema } from "@/lib/validation/attendance";
import { fieldErrors } from "@/lib/validation/common";
import type { LeaveRecord } from "@/server/services/leave-service";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/states";
import { Field, FieldGrid } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/**
 * Leave: request, track and (for approvers) decide.
 *
 * Approving is not cosmetic — approved leave feeds
 * `attendanceRepository.findApprovedLeave`, which flips those days from ABSENT
 * to ON_LEAVE. The confirmation copy says so, because an approver should know
 * they are editing attendance history.
 */

const STATUS_TONE = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "critical",
  CANCELLED: "neutral",
} as const;

interface Balance {
  type: keyof typeof LEAVE_TYPE_LABELS;
  entitled: number;
  taken: number;
  remaining: number;
}

export function LeaveWorkspace({
  myRequests,
  pendingReviews,
  balances,
  canApprove,
}: {
  myRequests: LeaveRecord[];
  pendingReviews: LeaveRecord[];
  balances: Balance[];
  canApprove: boolean;
}) {
  const pendingCount = pendingReviews.filter((entry) => entry.status === "PENDING").length;

  return (
    <div className="flex flex-col gap-5">
      {balances.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {balances.map((balance) => (
            <Card key={balance.type} className="p-5">
              <div className="flex items-baseline justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-medium text-ink">
                  {LEAVE_TYPE_LABELS[balance.type]}
                </p>
                <p className="shrink-0 text-xs tabular text-ink-muted">
                  {balance.taken} / {balance.entitled}
                </p>
              </div>
              <p className="mt-2 text-2xl font-semibold tracking-tight tabular text-ink">
                {balance.remaining}
                <span className="ml-1 text-sm font-medium text-ink-muted">days left</span>
              </p>
              <Progress
                className="mt-3"
                barSize="sm"
                value={(balance.taken / Math.max(1, balance.entitled)) * 100}
                tone={balance.remaining === 0 ? "critical" : balance.remaining <= 2 ? "warning" : "brand"}
                label={`${LEAVE_TYPE_LABELS[balance.type]} used`}
              />
            </Card>
          ))}
        </div>
      ) : null}

      <Tabs defaultValue={canApprove && pendingCount > 0 ? "approvals" : "mine"}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="mine">My requests</TabsTrigger>
            {canApprove ? (
              <TabsTrigger value="approvals">
                Approvals
                {pendingCount > 0 ? (
                  <Badge tone="warning" size="sm">
                    {pendingCount}
                  </Badge>
                ) : null}
              </TabsTrigger>
            ) : null}
          </TabsList>

          <RequestLeaveDialog />
        </div>

        <TabsContent value="mine">
          <Card className="overflow-hidden">
            {myRequests.length === 0 ? (
              <EmptyState
                icon={<Plane />}
                title="No leave requested"
                description="When you request time off, it appears here with its approval status."
                action={<RequestLeaveDialog />}
              />
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {myRequests.map((request) => (
                  <MyRequestRow key={request.id} request={request} />
                ))}
              </ul>
            )}
          </Card>
        </TabsContent>

        {canApprove ? (
          <TabsContent value="approvals">
            <Card className="overflow-hidden">
              {pendingReviews.length === 0 ? (
                <EmptyState
                  icon={<Check />}
                  title="Nothing to review"
                  description="Leave requests from your team will appear here for approval."
                />
              ) : (
                <ul className="divide-y divide-[var(--line)]">
                  {pendingReviews.map((request) => (
                    <ReviewRow key={request.id} request={request} />
                  ))}
                </ul>
              )}
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

function MyRequestRow({ request }: { request: LeaveRecord }) {
  const router = useRouter();
  const [cancelling, setCancelling] = React.useState(false);

  const cancel = async () => {
    setCancelling(true);
    try {
      const response = await fetch(`/api/leave/${request.id}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) {
        toast.error(body?.error?.message ?? "Couldn't withdraw that request");
        return;
      }
      toast.success("Request withdrawn");
      router.refresh();
    } finally {
      setCancelling(false);
    }
  };

  return (
    <li className="flex flex-wrap items-start gap-4 px-5 py-4 sm:px-6">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-ink">{LEAVE_TYPE_LABELS[request.type]}</p>
          <Badge tone={STATUS_TONE[request.status]} size="sm">
            {request.status.charAt(0) + request.status.slice(1).toLowerCase()}
          </Badge>
        </div>

        <p className="mt-1 text-sm text-ink-secondary">
          {formatDate(request.startDate)} – {formatDate(request.endDate)}
          <span className="text-ink-muted"> · {request.days} {request.days === 1 ? "day" : "days"}</span>
        </p>

        {request.reason ? (
          <p className="mt-1.5 line-clamp-2-safe text-xs leading-relaxed text-ink-muted">
            {request.reason}
          </p>
        ) : null}

        {request.reviewedAt && request.reviewer ? (
          <p className="mt-1.5 text-xs text-ink-muted">
            Reviewed by {request.reviewer.firstName} {request.reviewer.lastName}{" "}
            {formatRelative(request.reviewedAt)}
            {request.reviewNote ? ` — “${request.reviewNote}”` : ""}
          </p>
        ) : null}
      </div>

      {request.status === "PENDING" ? (
        <Button variant="ghost" size="sm" onClick={cancel} loading={cancelling}>
          Withdraw
        </Button>
      ) : null}
    </li>
  );
}

function ReviewRow({ request }: { request: LeaveRecord }) {
  const router = useRouter();
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState<"APPROVED" | "REJECTED" | null>(null);

  const decide = async (decision: "APPROVED" | "REJECTED") => {
    setPending(decision);
    try {
      const response = await fetch(`/api/leave/${request.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, reviewNote: note.trim() || undefined }),
      });
      const body = await response.json();

      if (!response.ok) {
        toast.error(body?.error?.message ?? "Couldn't record that decision");
        return;
      }

      toast.success(decision === "APPROVED" ? "Leave approved" : "Leave declined", {
        description:
          decision === "APPROVED"
            ? "Those days now show as On leave in attendance."
            : `${request.employee.firstName} has been notified.`,
      });
      router.refresh();
    } finally {
      setPending(null);
    }
  };

  const decided = request.status !== "PENDING";

  return (
    <li className={cn("px-5 py-4 sm:px-6", decided && "opacity-70")}>
      <div className="flex flex-wrap items-start gap-4">
        <Avatar
          name={`${request.employee.firstName} ${request.employee.lastName}`}
          src={request.employee.avatarUrl}
          size="md"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-ink">
              {request.employee.firstName} {request.employee.lastName}
            </p>
            <Badge tone={STATUS_TONE[request.status]} size="sm">
              {request.status.charAt(0) + request.status.slice(1).toLowerCase()}
            </Badge>
          </div>

          <p className="mt-0.5 text-xs text-ink-muted">{request.employee.designation}</p>

          <p className="mt-2 text-sm text-ink-secondary">
            <span className="font-medium text-ink">{LEAVE_TYPE_LABELS[request.type]}</span>
            {" · "}
            {formatDate(request.startDate)} – {formatDate(request.endDate)}
            <span className="text-ink-muted"> · {request.days} {request.days === 1 ? "day" : "days"}</span>
          </p>

          {request.reason ? (
            <p className="mt-2 rounded-lg bg-surface-2/60 px-3 py-2 text-xs leading-relaxed text-ink-secondary">
              {request.reason}
            </p>
          ) : null}

          {!decided ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Add a note (optional)"
                inputSize="sm"
                aria-label={`Review note for ${request.employee.firstName}`}
                className="max-w-xs"
              />
              <Button
                variant="success"
                size="sm"
                onClick={() => decide("APPROVED")}
                loading={pending === "APPROVED"}
                disabled={pending !== null}
              >
                <Check aria-hidden />
                Approve
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => decide("REJECTED")}
                loading={pending === "REJECTED"}
                disabled={pending !== null}
              >
                <X aria-hidden />
                Decline
              </Button>
            </div>
          ) : request.reviewNote ? (
            <p className="mt-2 text-xs text-ink-muted">Note: “{request.reviewNote}”</p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** Request dialog. Days are derived from the range but stay editable for half days. */
function RequestLeaveDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});

  const [type, setType] = React.useState<string>("CASUAL");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [days, setDays] = React.useState("1");
  const [reason, setReason] = React.useState("");

  // Recompute the day count whenever the range changes, but leave it editable
  // so someone can request a half day.
  React.useEffect(() => {
    if (!startDate || !endDate) return;
    const start = new Date(`${startDate}T00:00:00Z`).getTime();
    const end = new Date(`${endDate}T00:00:00Z`).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) return;
    setDays(String(Math.round((end - start) / 86_400_000) + 1));
  }, [startDate, endDate]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrors({});

    const payload = {
      type,
      startDate,
      endDate,
      days: Number(days),
      reason: reason.trim(),
    };

    const parsed = requestLeaveSchema.safeParse(payload);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/leave", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();

      if (!response.ok) {
        if (body?.error?.details) setErrors(body.error.details);
        toast.error(body?.error?.message ?? "Couldn't submit that request");
        return;
      }

      toast.success("Leave requested", { description: "Your manager has been notified." });
      setOpen(false);
      setReason("");
      setStartDate("");
      setEndDate("");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const firstError = (key: string) => errors[key]?.[0] ?? null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <CalendarPlus aria-hidden />
          Request leave
        </Button>
      </DialogTrigger>

      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Request leave</DialogTitle>
          <DialogDescription>
            Your manager is notified immediately. Approved days show as On leave in attendance.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} noValidate>
          <DialogBody className="flex flex-col gap-5">
            {errors._form ? (
              <p className="rounded-lg bg-critical-soft px-3 py-2 text-sm text-critical">
                {errors._form[0]}
              </p>
            ) : null}

            <Field label="Leave type" required error={firstError("type")}>
              {(control) => (
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger id={control.id}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(LEAVE_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>

            <FieldGrid>
              <Field label="From" required error={firstError("startDate")}>
                {(control) => (
                  <Input
                    {...control}
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                )}
              </Field>

              <Field label="To" required error={firstError("endDate")}>
                {(control) => (
                  <Input
                    {...control}
                    type="date"
                    value={endDate}
                    min={startDate || undefined}
                    onChange={(event) => setEndDate(event.target.value)}
                  />
                )}
              </Field>
            </FieldGrid>

            <Field
              label="Days"
              required
              hint="Calculated from the dates. Change it to 0.5 for a half day."
              error={firstError("days")}
            >
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  min={0.5}
                  step={0.5}
                  inputMode="decimal"
                  value={days}
                  onChange={(event) => setDays(event.target.value)}
                />
              )}
            </Field>

            <Field label="Reason" required error={firstError("reason")}>
              {(control) => (
                <Textarea
                  {...control}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={3}
                  placeholder="A short explanation for your manager."
                />
              )}
            </Field>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Submit request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
