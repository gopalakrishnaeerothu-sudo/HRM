"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Permission } from "@/server/auth/permissions";
import { LogoLockup } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { isActive, visibleSections, type NavSection } from "@/components/app-shell/navigation";

/**
 * Desktop sidebar.
 *
 * The active indicator is a shared layout element (`layoutId`), so moving
 * between routes slides one pill rather than cross-fading two — the detail
 * that makes the navigation feel continuous.
 *
 * Collapsed state persists in localStorage; it is read after mount so the
 * server and client markup agree on first paint.
 */

const STORAGE_KEY = "tfhr:sidebar-collapsed";

export function Sidebar({
  permissions,
  organizationName,
  productName,
}: {
  permissions: Permission[];
  organizationName: string;
  productName: string;
}) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "true");
  }, []);

  const toggle = React.useCallback(() => {
    setCollapsed((previous) => {
      const next = !previous;
      window.localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  const permissionSet = React.useMemo(() => new Set(permissions), [permissions]);
  const sections: NavSection[] = React.useMemo(
    () => visibleSections((permission) => permissionSet.has(permission)),
    [permissionSet],
  );

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 p-3 transition-[width] duration-300 ease-[var(--ease-out-quint)] lg:block",
        collapsed ? "w-[4.75rem]" : "w-[17rem]",
      )}
      data-collapsed={collapsed}
    >
      <div className="glass-panel flex h-full flex-col rounded-2xl">
        <div
          className={cn(
            "flex h-16 shrink-0 items-center border-b border-line px-3",
            collapsed ? "justify-center" : "justify-between",
          )}
        >
          <Link
            href="/app"
            className="flex min-w-0 items-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            <LogoLockup name={productName} collapsed={collapsed} />
          </Link>
          {collapsed ? null : (
            <Button variant="ghost" size="icon-xs" onClick={toggle} aria-label="Collapse sidebar">
              <PanelLeftClose aria-hidden />
            </Button>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-4" aria-label="Sidebar">
          {sections.map((section) => (
            <div key={section.title} className="mb-5 last:mb-0">
              {collapsed ? (
                <div className="mx-2 mb-2 h-px bg-line" aria-hidden />
              ) : (
                <p className="mb-2 px-2.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-muted">
                  {section.title}
                </p>
              )}

              <ul className="flex flex-col gap-0.5">
                {section.items.map((item) => {
                  const active = isActive(pathname, item);
                  const link = (
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex h-10 items-center gap-3 rounded-lg px-2.5 text-sm font-medium transition-colors",
                        collapsed && "justify-center px-0",
                        active ? "text-brand" : "text-ink-secondary hover:bg-surface-2 hover:text-ink",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
                      )}
                    >
                      {active ? (
                        <motion.span
                          layoutId="sidebar-active"
                          className="absolute inset-0 -z-10 rounded-lg bg-brand-soft"
                          transition={
                            reduceMotion
                              ? { duration: 0 }
                              : { type: "spring", stiffness: 420, damping: 34 }
                          }
                        />
                      ) : null}
                      <item.icon className="size-[1.125rem] shrink-0" aria-hidden />
                      {collapsed ? (
                        <span className="sr-only">{item.label}</span>
                      ) : (
                        <span className="truncate">{item.label}</span>
                      )}
                    </Link>
                  );

                  return (
                    <li key={item.href}>
                      {collapsed ? (
                        <Tooltip content={item.label} side="right">
                          {link}
                        </Tooltip>
                      ) : (
                        link
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-line p-3">
          {collapsed ? (
            <Button variant="ghost" size="icon-sm" onClick={toggle} block aria-label="Expand sidebar">
              <PanelLeftOpen aria-hidden />
            </Button>
          ) : (
            <div className="rounded-xl bg-surface-2/70 px-3 py-2.5">
              <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-ink-muted">
                Organisation
              </p>
              <p className="mt-0.5 truncate text-sm font-semibold text-ink">{organizationName}</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
