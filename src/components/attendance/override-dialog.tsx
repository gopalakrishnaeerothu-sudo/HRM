"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PencilLine, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { ATTENDANCE_STATUS_LABELS } from "@/lib/validation/attendance";
import { Button } from "@/components/ui/button";
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
import { Field, FieldGrid } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * HR/admin correction of an attendance record.
 *
 * The reason field is required and minimum-length by schema, not by politeness:
 * the override writes an ATTENDANCE_OVERRIDE audit entry carrying the actor,
 * the before/after values and that reason. The dialog says so plainly, because
 * someone editing another person's attendance should know it is on the record.
 */

const EDITABLE_STATUSES = [
  "PRESENT",
  "LATE",
  "HALF_DAY",
  "ABSENT",
  "ON_LEAVE",
  "HOLIDAY",
] as const;

export interface OverrideTarget {
  employeeId: string;
  employeeName: string;
  date: string;
  currentStatus: string;
  checkInAt: string | null;
  checkOutAt: string | null;
}

/** Convert an ISO instant into the `datetime-local` value format. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function AttendanceOverrideDialog({ target }: { target: OverrideTarget }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});

  const [status, setStatus] = React.useState(target.currentStatus);
  const [checkIn, setCheckIn] = React.useState(toLocalInput(target.checkInAt));
  const [checkOut, setCheckOut] = React.useState(toLocalInput(target.checkOutAt));
  const [reason, setReason] = React.useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrors({});

    if (reason.trim().length < 10) {
      setErrors({ reason: ["Give at least 10 characters — this is written to the audit log."] });
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/attendance/override", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          employeeId: target.employeeId,
          date: target.date,
          status,
          checkInAt: checkIn ? new Date(checkIn).toISOString() : null,
          checkOutAt: checkOut ? new Date(checkOut).toISOString() : null,
          reason: reason.trim(),
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        if (body?.error?.details) setErrors(body.error.details);
        toast.error(body?.error?.message ?? "Couldn't save that correction");
        return;
      }

      toast.success("Attendance corrected", {
        description: `${target.employeeName}'s record is marked as a manual entry.`,
      });
      setOpen(false);
      setReason("");
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Correct attendance for ${target.employeeName}`}
        >
          <PencilLine aria-hidden />
        </Button>
      </DialogTrigger>

      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Correct attendance</DialogTitle>
          <DialogDescription>
            {target.employeeName} · {target.date}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} noValidate>
          <DialogBody className="flex flex-col gap-5">
            <div className="flex items-start gap-3 rounded-xl border border-warning/35 bg-warning-soft/50 px-4 py-3">
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <p className="text-xs leading-relaxed text-ink-secondary">
                This marks the record as a manual entry and writes an audit entry with your name,
                the before and after values, and the reason you give below.
              </p>
            </div>

            <Field label="Status" required error={errors.status?.[0]}>
              {(control) => (
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger id={control.id}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EDITABLE_STATUSES.map((value) => (
                      <SelectItem key={value} value={value}>
                        {ATTENDANCE_STATUS_LABELS[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>

            <FieldGrid>
              <Field label="Check-in" optional error={errors.checkInAt?.[0]}>
                {(control) => (
                  <Input
                    {...control}
                    type="datetime-local"
                    value={checkIn}
                    onChange={(event) => setCheckIn(event.target.value)}
                  />
                )}
              </Field>

              <Field label="Check-out" optional error={errors.checkOutAt?.[0]}>
                {(control) => (
                  <Input
                    {...control}
                    type="datetime-local"
                    value={checkOut}
                    onChange={(event) => setCheckOut(event.target.value)}
                  />
                )}
              </Field>
            </FieldGrid>

            <Field
              label="Reason"
              required
              hint="Why this needs correcting. Stored in the audit log."
              error={errors.reason?.[0]}
            >
              {(control) => (
                <Textarea
                  {...control}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={3}
                  placeholder="Device battery died before check-out; confirmed with the team lead."
                />
              )}
            </Field>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Save correction
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
