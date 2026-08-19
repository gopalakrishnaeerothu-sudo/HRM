"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  Ban,
  Check,
  KeyRound,
  Loader2,
  LogOut,
  ShieldCheck,
  Unlock,
  UserCog,
  X,
} from "lucide-react";

import { ROLE_LABELS } from "@/server/auth/permissions";
import type { UserRole, UserStatus } from "@/server/db/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableMessageRow,
  TableRow,
  TableWrap,
} from "@/components/ui/table";

/**
 * The access table and its actions.
 *
 * Every button here is a thin trigger for a server route. Nothing in this file
 * decides whether an action is allowed: `assignableRoles` narrows the dropdown
 * and `canAct` hides buttons, but both are conveniences that stop someone
 * clicking a control that will fail. The server re-derives the same answers
 * from the session, and a request forged past this UI is refused there.
 */

export interface AccessUserView {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
  statusReason: string | null;
  activeSessions: number;
  employee: { departmentName: string | null; designation: string } | null;
}

const STATUS_TONE: Record<UserStatus, "success" | "warning" | "critical" | "neutral" | "info"> = {
  ACTIVE: "success",
  PENDING: "warning",
  INVITED: "info",
  DISABLED: "critical",
  REJECTED: "critical",
  LOCKED: "warning",
};

const STATUS_LABEL: Record<UserStatus, string> = {
  ACTIVE: "Active",
  PENDING: "Pending",
  INVITED: "Invited",
  DISABLED: "Disabled",
  REJECTED: "Rejected",
  LOCKED: "Locked",
};

function formatWhen(iso: string | null): string {
  if (!iso) return "Never";

  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);

  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;

  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

interface Props {
  users: AccessUserView[];
  /** Roles this administrator may hand out, resolved server-side. */
  assignableRoles: UserRole[];
  /** Ids this administrator outranks, resolved server-side. */
  actionableIds: string[];
  canApprove: boolean;
  canManage: boolean;
  canAssignRoles: boolean;
}

export function AccessTable({
  users,
  assignableRoles,
  actionableIds,
  canApprove,
  canManage,
  canAssignRoles,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approving, setApproving] = useState<AccessUserView | null>(null);
  const [approveRole, setApproveRole] = useState<UserRole>(assignableRoles[0] ?? "EMPLOYEE");

  const actionable = new Set(actionableIds);

  async function call(path: string, init: RequestInit) {
    setError(null);

    const response = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      throw new Error(payload?.error?.message ?? "That action failed. Please try again.");
    }

    // The page is a server component, so refreshing is what re-reads the row
    // from PostgreSQL rather than trusting an optimistic local edit.
    startTransition(() => router.refresh());
  }

  async function run(userId: string, action: () => Promise<void>) {
    setBusyId(userId);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That action failed.");
    } finally {
      setBusyId(null);
    }
  }

  function approve() {
    const target = approving;
    if (!target) return;

    void run(target.id, async () => {
      await call(`/api/users/${target.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ role: approveRole }),
      });
      setApproving(null);
    });
  }

  function reject(user: AccessUserView) {
    void run(user.id, () => call(`/api/users/${user.id}/reject`, { method: "POST", body: "{}" }));
  }

  function setStatus(user: AccessUserView, status: "ACTIVE" | "DISABLED") {
    void run(user.id, () =>
      call(`/api/users/${user.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    );
  }

  function changeRole(user: AccessUserView, role: UserRole) {
    void run(user.id, () =>
      call(`/api/users/${user.id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role, expectedRole: user.role }),
      }),
    );
  }

  function revokeSessions(user: AccessUserView) {
    void run(user.id, () => call(`/api/users/${user.id}/sessions`, { method: "DELETE" }));
  }

  return (
    <>
      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-critical/30 bg-critical/10 px-4 py-3 text-sm text-critical"
        >
          {error}
        </p>
      ) : null}

      <TableWrap>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Department</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last login</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {users.length === 0 ? (
              <TableMessageRow colSpan={7}>No accounts match this filter.</TableMessageRow>
            ) : (
              users.map((user) => {
                const busy = busyId === user.id || pending;
                const mayAct = actionable.has(user.id);

                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <span className="font-medium text-ink">{user.name}</span>
                      {user.employee ? (
                        <span className="block text-xs text-ink-muted">
                          {user.employee.designation}
                        </span>
                      ) : (
                        <span className="block text-xs text-ink-muted">No employee profile</span>
                      )}
                    </TableCell>

                    <TableCell className="text-ink-secondary">{user.email}</TableCell>

                    <TableCell className="text-ink-secondary">
                      {user.employee?.departmentName ?? "—"}
                    </TableCell>

                    <TableCell>
                      {canAssignRoles && mayAct && user.status !== "PENDING" ? (
                        <Select
                          value={user.role}
                          disabled={busy || assignableRoles.length === 0}
                          onValueChange={(value) => changeRole(user, value as UserRole)}
                        >
                          <SelectTrigger className="h-8 w-[9.5rem]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {/* The current role is listed even when it is not
                                assignable, so the trigger has something to
                                render; picking it is a no-op server-side. */}
                            {(assignableRoles.includes(user.role)
                              ? assignableRoles
                              : [user.role, ...assignableRoles]
                            ).map((role) => (
                              <SelectItem
                                key={role}
                                value={role}
                                disabled={!assignableRoles.includes(role)}
                              >
                                {ROLE_LABELS[role]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge tone="outline" size="sm">
                          {ROLE_LABELS[user.role]}
                        </Badge>
                      )}
                    </TableCell>

                    <TableCell>
                      <Badge tone={STATUS_TONE[user.status]} size="sm">
                        {STATUS_LABEL[user.status]}
                      </Badge>
                      {user.status === "PENDING" ? (
                        <span className="block text-xs text-ink-muted">
                          Requested {formatWhen(user.createdAt).toLowerCase()}
                        </span>
                      ) : null}
                    </TableCell>

                    <TableCell className="text-ink-secondary">
                      {formatWhen(user.lastLoginAt)}
                    </TableCell>

                    <TableCell>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {busy ? (
                          <Loader2 className="size-4 animate-spin text-ink-muted" aria-hidden />
                        ) : null}

                        {!mayAct ? (
                          <span className="text-xs text-ink-muted">—</span>
                        ) : (
                          <>
                            {user.status === "PENDING" && canApprove ? (
                              <>
                                <Button
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => {
                                    setApproveRole(assignableRoles[0] ?? "EMPLOYEE");
                                    setApproving(user);
                                  }}
                                >
                                  <Check className="size-3.5" aria-hidden />
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={busy}
                                  onClick={() => reject(user)}
                                >
                                  <X className="size-3.5" aria-hidden />
                                  Reject
                                </Button>
                              </>
                            ) : null}

                            {canManage && user.status === "ACTIVE" ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy}
                                onClick={() => setStatus(user, "DISABLED")}
                              >
                                <Ban className="size-3.5" aria-hidden />
                                Disable
                              </Button>
                            ) : null}

                            {canManage && (user.status === "DISABLED" || user.status === "LOCKED") ? (
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy}
                                onClick={() => setStatus(user, "ACTIVE")}
                              >
                                {user.status === "LOCKED" ? (
                                  <Unlock className="size-3.5" aria-hidden />
                                ) : (
                                  <ShieldCheck className="size-3.5" aria-hidden />
                                )}
                                {user.status === "LOCKED" ? "Unlock" : "Enable"}
                              </Button>
                            ) : null}

                            {canManage && user.activeSessions > 0 ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy}
                                title={`Sign out of ${user.activeSessions} session${
                                  user.activeSessions === 1 ? "" : "s"
                                }`}
                                onClick={() => revokeSessions(user)}
                              >
                                <LogOut className="size-3.5" aria-hidden />
                                Revoke
                              </Button>
                            ) : null}
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableWrap>

      <Dialog open={approving !== null} onOpenChange={(open) => !open && setApproving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve access</DialogTitle>
            <DialogDescription>
              {approving
                ? `${approving.name} (${approving.email}) will be able to sign in once you approve.`
                : null}
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            <Field label="Role" required hint="What this person will be able to do.">
              {(control) => (
                <Select
                  value={approveRole}
                  onValueChange={(value) => setApproveRole(value as UserRole)}
                >
                  <SelectTrigger {...control}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {assignableRoles.map((role) => (
                      <SelectItem key={role} value={role}>
                        {ROLE_LABELS[role]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          </DialogBody>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setApproving(null)}>
              Cancel
            </Button>
            <Button onClick={approve} disabled={busyId !== null}>
              <UserCog className="size-4" aria-hidden />
              Approve as {ROLE_LABELS[approveRole]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The organisation's signup code.
 *
 * Shown rather than hidden: it is not a secret in the cryptographic sense — it
 * only puts someone in a queue — and an administrator who cannot read it
 * cannot share it. Rotating is one click, which is the actual remedy if it
 * spreads further than intended.
 */
export function JoinCodePanel({ code, canRotate }: { code: string | null; canRotate: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rotate(enabled: boolean) {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/users/join-code", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(payload?.error?.message ?? "Could not update the code.");
      }

      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <KeyRound className="size-4 text-ink-muted" aria-hidden />

      {code ? (
        <Input
          readOnly
          value={code}
          aria-label="Organisation signup code"
          onFocus={(event) => event.currentTarget.select()}
          className="w-44 font-mono tracking-[0.2em]"
        />
      ) : (
        <span className="text-sm text-ink-muted">
          Self-signup is off. Nobody can request access.
        </span>
      )}

      {canRotate ? (
        <>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => rotate(true)}>
            {code ? "Rotate" : "Enable signup"}
          </Button>
          {code ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => rotate(false)}>
              Turn off
            </Button>
          ) : null}
        </>
      ) : null}

      {error ? <span className="text-sm text-critical">{error}</span> : null}
    </div>
  );
}
