"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import type { Permission } from "@/server/auth/permissions";
import { LogoLockup } from "@/components/brand/logo";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { isActive, primaryNavItems, visibleSections } from "@/components/app-shell/navigation";

/**
 * Mobile navigation — two complementary surfaces:
 *
 *  - `MobileBottomBar` pins the five most-used destinations within thumb reach.
 *  - `MobileNavDrawer` holds the complete, grouped navigation.
 *
 * Both read the same definition as the desktop sidebar, so nothing can drift.
 */

export function MobileNavDrawer({
  open,
  onOpenChange,
  permissions,
  productName,
  organizationName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  permissions: Permission[];
  productName: string;
  organizationName: string;
}) {
  const pathname = usePathname();
  const permissionSet = React.useMemo(() => new Set(permissions), [permissions]);
  const sections = React.useMemo(
    () => visibleSections((permission) => permissionSet.has(permission)),
    [permissionSet],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left">
        <SheetHeader>
          <SheetTitle asChild>
            <span>
              <LogoLockup name={productName} />
            </span>
          </SheetTitle>
          <p className="text-xs text-ink-muted">{organizationName}</p>
        </SheetHeader>

        <SheetBody className="px-3">
          <nav aria-label="Mobile navigation">
            {sections.map((section) => (
              <div key={section.title} className="mb-5 last:mb-0">
                <p className="mb-2 px-2.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-muted">
                  {section.title}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {section.items.map((item) => {
                    const active = isActive(pathname, item);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          onClick={() => onOpenChange(false)}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "flex h-11 items-center gap-3 rounded-lg px-2.5 text-sm font-medium transition-colors",
                            active
                              ? "bg-brand-soft text-brand"
                              : "text-ink-secondary hover:bg-surface-2 hover:text-ink",
                          )}
                        >
                          <item.icon className="size-[1.125rem] shrink-0" aria-hidden />
                          <span className="truncate">{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

export function MobileBottomBar({ permissions }: { permissions: Permission[] }) {
  const pathname = usePathname();
  const permissionSet = React.useMemo(() => new Set(permissions), [permissions]);
  const items = React.useMemo(
    () => primaryNavItems((permission) => permissionSet.has(permission)),
    [permissionSet],
  );

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 lg:hidden"
      aria-label="Primary"
      // Clears the iOS home indicator without leaving a gap on Android.
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="glass-panel mx-3 mb-3 flex items-stretch gap-1 rounded-2xl p-1.5">
        {items.map((item) => {
          const active = isActive(pathname, item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl py-2 transition-colors",
                active ? "bg-brand-soft text-brand" : "text-ink-muted hover:text-ink",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
              )}
            >
              <item.icon className="size-[1.125rem] shrink-0" aria-hidden />
              <span className="w-full truncate px-1 text-center text-[0.625rem] font-medium leading-tight">
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
