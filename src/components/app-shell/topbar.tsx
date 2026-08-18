"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, LogOut, Menu, Search, Settings, User as UserIcon } from "lucide-react";

import { cn, initials } from "@/lib/utils";
import { formatRelative } from "@/lib/time";
import { ROLE_LABELS } from "@/server/auth/permissions";
import type { Permission } from "@/server/auth/permissions";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme-toggle";
import { CommandPalette, useCommandPalette } from "@/components/app-shell/command-palette";
import { MobileNavDrawer } from "@/components/app-shell/mobile-nav";
import { DevRoleSwitcher } from "@/components/app-shell/dev-role-switcher";

export interface TopbarUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: keyof typeof ROLE_LABELS;
  designation: string | null;
}

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  linkUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

/**
 * Application top bar: mobile menu, search trigger, notifications, theme and
 * the profile menu.
 *
 * The search control is a button, not an input — pressing it opens the command
 * palette, which is the same surface ⌘K opens, so there is only one search
 * experience to learn.
 */
export function Topbar({
  user,
  organizationName,
  productName,
  permissions,
  unreadCount,
  devAuthEnabled,
}: {
  user: TopbarUser;
  organizationName: string;
  productName: string;
  permissions: Permission[];
  unreadCount: number;
  devAuthEnabled: boolean;
}) {
  const { open, setOpen } = useCommandPalette();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [notifications, setNotifications] = React.useState<NotificationItem[]>([]);
  const [unread, setUnread] = React.useState(unreadCount);
  const [loadingNotifications, setLoadingNotifications] = React.useState(false);
  const pathname = usePathname();
  const router = useRouter();

  React.useEffect(() => setDrawerOpen(false), [pathname]);

  const loadNotifications = React.useCallback(async () => {
    setLoadingNotifications(true);
    try {
      const response = await fetch("/api/notifications");
      if (!response.ok) return;
      const payload = (await response.json()) as {
        data: { items: NotificationItem[]; unread: number };
      };
      setNotifications(payload.data.items);
      setUnread(payload.data.unread);
    } finally {
      setLoadingNotifications(false);
    }
  }, []);

  const markAllRead = async () => {
    // Optimistic: the badge clears immediately, and the request follows.
    setUnread(0);
    setNotifications((items) => items.map((item) => ({ ...item, readAt: new Date().toISOString() })));
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    router.refresh();
  };

  return (
    <>
      <header className="sticky top-0 z-30 px-3 pt-3 lg:px-0 lg:pr-3">
        <div className="glass-panel flex h-16 items-center gap-2 rounded-2xl px-3 sm:gap-3 sm:px-4">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
          >
            <Menu aria-hidden />
          </Button>

          <button
            type="button"
            onClick={() => setOpen(true)}
            className={cn(
              "group flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-line bg-surface-1/70 px-3 text-left transition-colors",
              "hover:border-line-strong hover:bg-surface-1",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
              "sm:max-w-md",
            )}
          >
            <Search className="size-4 shrink-0 text-ink-muted" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm text-ink-muted">
              Search people, tasks, offices…
            </span>
            <kbd className="hidden shrink-0 rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[0.625rem] font-medium text-ink-muted sm:inline-block">
              ⌘K
            </kbd>
          </button>

          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
            {devAuthEnabled ? <DevRoleSwitcher currentUserId={user.id} /> : null}

            <ThemeToggle />

            <Popover
              onOpenChange={(nextOpen) => {
                if (nextOpen) void loadNotifications();
              }}
            >
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="relative" aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}>
                  <Bell className="size-[1.125rem]" aria-hidden />
                  {unread > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-critical px-1 text-[0.5625rem] font-semibold leading-4 text-white">
                      {unread > 9 ? "9+" : unread}
                    </span>
                  ) : null}
                </Button>
              </PopoverTrigger>

              <PopoverContent align="end" className="w-[21rem] p-0">
                <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
                  <p className="text-sm font-semibold text-ink">Notifications</p>
                  {unread > 0 ? (
                    <Button variant="link" size="xs" onClick={markAllRead}>
                      Mark all read
                    </Button>
                  ) : null}
                </div>

                <div className="max-h-80 overflow-y-auto">
                  {loadingNotifications ? (
                    <p className="px-4 py-8 text-center text-sm text-ink-muted">Loading…</p>
                  ) : notifications.length === 0 ? (
                    <p className="px-4 py-10 text-center text-sm text-ink-muted">
                      You&apos;re all caught up.
                    </p>
                  ) : (
                    <ul className="divide-y divide-[var(--line)]">
                      {notifications.map((notification) => {
                        const content = (
                          <div
                            className={cn(
                              "flex gap-3 px-4 py-3 transition-colors hover:bg-surface-2",
                              !notification.readAt && "bg-brand-soft/40",
                            )}
                          >
                            <span
                              className={cn(
                                "mt-1.5 size-2 shrink-0 rounded-full",
                                notification.readAt ? "bg-transparent" : "bg-brand",
                              )}
                              aria-hidden
                            />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-ink">{notification.title}</p>
                              <p className="mt-0.5 line-clamp-2-safe text-xs leading-relaxed text-ink-muted">
                                {notification.body}
                              </p>
                              <p className="mt-1 text-[0.6875rem] text-ink-muted">
                                {formatRelative(new Date(notification.createdAt))}
                              </p>
                            </div>
                          </div>
                        );

                        return (
                          <li key={notification.id}>
                            {notification.linkUrl ? (
                              <Link href={notification.linkUrl}>{content}</Link>
                            ) : (
                              content
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div className="border-t border-line p-2">
                  <Button variant="ghost" size="sm" block asChild>
                    <Link href="/app/notifications">View all</Link>
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-lg p-1 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                  aria-label={`Account menu for ${user.name}`}
                >
                  <Avatar name={user.name} src={user.avatarUrl} size="sm" />
                  <span className="hidden min-w-0 text-left sm:block">
                    <span className="block max-w-[9rem] truncate text-sm font-medium leading-tight text-ink">
                      {user.name}
                    </span>
                    <span className="block text-[0.6875rem] leading-tight text-ink-muted">
                      {ROLE_LABELS[user.role]}
                    </span>
                  </span>
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="normal-case tracking-normal">
                  <span className="flex items-center gap-3 py-1">
                    <Avatar name={user.name} src={user.avatarUrl} size="md" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-ink">{user.name}</span>
                      <span className="block truncate text-xs font-normal text-ink-muted">
                        {user.email}
                      </span>
                    </span>
                  </span>
                </DropdownMenuLabel>

                <div className="px-2.5 pb-2">
                  <Badge tone="brand" size="sm">
                    {ROLE_LABELS[user.role]}
                  </Badge>
                  <span className="ml-1.5 text-[0.6875rem] text-ink-muted">{organizationName}</span>
                </div>

                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/app/settings/profile">
                    <UserIcon />
                    My profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/app/settings">
                    <Settings />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/">
                    <LogOut />
                    Back to {productName}
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <CommandPalette open={open} onOpenChange={setOpen} />
      <MobileNavDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        permissions={permissions}
        productName={productName}
        organizationName={organizationName}
      />
    </>
  );
}

export { initials };
