"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { ROLE_LABELS } from "@/server/auth/permissions";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * DEVELOPMENT-ONLY user switcher.
 *
 * Rendered only when the server told us `DEV_AUTH_ENABLED` is on and we are not
 * in production; the API behind it (`/api/dev/session`) refuses in production
 * regardless of what the client believes. Deleting this component and
 * `src/app/api/dev` is all that is needed once real sign-in exists.
 */

interface DevUser {
  id: string;
  name: string;
  email: string;
  role: keyof typeof ROLE_LABELS;
  avatarUrl: string | null;
  employee: { designation: string; employeeCode: string } | null;
}

export function DevRoleSwitcher({ currentUserId }: { currentUserId: string }) {
  const router = useRouter();
  const [users, setUsers] = React.useState<DevUser[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [switching, setSwitching] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (users.length > 0) return;
    setLoading(true);
    try {
      const response = await fetch("/api/dev/session");
      if (!response.ok) return;
      const payload = (await response.json()) as { data: DevUser[] };
      setUsers(payload.data);
    } finally {
      setLoading(false);
    }
  }, [users.length]);

  const switchTo = async (user: DevUser) => {
    setSwitching(user.id);
    try {
      const response = await fetch("/api/dev/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      if (!response.ok) throw new Error("switch failed");

      toast.success(`Now viewing as ${user.name}`, {
        description: `${ROLE_LABELS[user.role]} · demo session`,
      });
      router.refresh();
    } catch {
      toast.error("Couldn't switch user", { description: "Check the server logs." });
    } finally {
      setSwitching(null);
    }
  };

  // One entry per role keeps the menu short and makes the four dashboard
  // experiences one click apart.
  const byRole = React.useMemo(() => {
    const groups = new Map<string, DevUser[]>();
    for (const user of users) {
      const bucket = groups.get(user.role) ?? [];
      bucket.push(user);
      groups.set(user.role, bucket);
    }
    return Array.from(groups.entries());
  }, [users]);

  return (
    <DropdownMenu onOpenChange={(open) => open && void load()}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Switch demo user (development only)"
          className="text-warning"
        >
          <FlaskConical className="size-[1.125rem]" aria-hidden />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="max-h-[26rem] w-72 overflow-y-auto">
        <DropdownMenuLabel className="normal-case tracking-normal">
          <span className="flex items-center gap-2">
            <FlaskConical className="size-3.5 text-warning" aria-hidden />
            Demo sign-in
          </span>
        </DropdownMenuLabel>
        <p className="px-2.5 pb-2 text-[0.6875rem] leading-relaxed text-ink-muted">
          Development only — no password is checked. Disabled automatically in production.
        </p>
        <DropdownMenuSeparator />

        {loading ? (
          <p className="flex items-center justify-center gap-2 py-6 text-sm text-ink-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading accounts…
          </p>
        ) : users.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-ink-muted">
            No seeded users. Run <code className="font-mono text-xs">npm run db:seed</code>.
          </p>
        ) : (
          byRole.map(([role, roleUsers]) => (
            <div key={role}>
              <p className="px-2.5 pb-1 pt-2 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-muted">
                {ROLE_LABELS[role as keyof typeof ROLE_LABELS]}
              </p>
              {roleUsers.slice(0, 3).map((user) => (
                <DropdownMenuItem
                  key={user.id}
                  onSelect={(event) => {
                    event.preventDefault();
                    void switchTo(user);
                  }}
                  className="gap-3"
                >
                  <Avatar name={user.name} src={user.avatarUrl} size="xs" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{user.name}</span>
                    <span className="block truncate text-[0.6875rem] text-ink-muted">
                      {user.employee?.designation ?? user.email}
                    </span>
                  </span>
                  {switching === user.id ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : user.id === currentUserId ? (
                    <Badge tone="brand" size="sm">
                      Current
                    </Badge>
                  ) : null}
                </DropdownMenuItem>
              ))}
            </div>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
