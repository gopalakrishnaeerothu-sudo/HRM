"use client";

import * as React from "react";
import Link from "next/link";
import { Menu } from "lucide-react";

import { branding } from "@/lib/branding";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const NAV_LINKS = [
  { href: "#product", label: "Product" },
  { href: "#geofencing", label: "Geofencing" },
  { href: "#tasks", label: "Tasks" },
  { href: "#attendance", label: "Attendance" },
  { href: "#analytics", label: "Analytics" },
];

export function MarketingHeader() {
  const [scrolled, setScrolled] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300",
        // The bar only gains its glass treatment once the page has scrolled,
        // so it doesn't compete with the hero at rest.
        scrolled ? "px-3 pt-3" : "px-0 pt-0",
      )}
    >
      <div
        className={cn(
          "mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-5 transition-all duration-300 sm:px-6",
          scrolled ? "glass-panel rounded-2xl" : "border-b border-transparent",
        )}
      >
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        >
          <Logo className="size-8" />
          <span className="text-[0.9375rem] font-semibold tracking-tight text-ink">{branding.name}</span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Main">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-ink-secondary transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <Button size="sm" asChild className="hidden sm:inline-flex">
            <Link href="/app">Open workspace</Link>
          </Button>

          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Open menu">
                <Menu className="size-5" aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[18rem]">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2.5">
                  <Logo className="size-7" />
                  {branding.name}
                </SheetTitle>
              </SheetHeader>
              <SheetBody>
                <nav className="flex flex-col gap-1" aria-label="Mobile">
                  {NAV_LINKS.map((link) => (
                    <a
                      key={link.href}
                      href={link.href}
                      onClick={() => setMobileOpen(false)}
                      className="rounded-lg px-3 py-2.5 text-sm font-medium text-ink-secondary transition-colors hover:bg-surface-2 hover:text-ink"
                    >
                      {link.label}
                    </a>
                  ))}
                </nav>
                <Button block className="mt-6" asChild>
                  <Link href="/app">Open workspace</Link>
                </Button>
              </SheetBody>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

const FOOTER_COLUMNS = [
  {
    title: "Platform",
    links: [
      { label: "Dashboard", href: "/app" },
      { label: "Employees", href: "/app/employees" },
      { label: "Tasks", href: "/app/tasks" },
      { label: "Attendance", href: "/app/attendance" },
    ],
  },
  {
    title: "Operations",
    links: [
      { label: "Office locations", href: "/app/locations" },
      { label: "Reports", href: "/app/reports" },
      { label: "Settings", href: "/app/settings" },
      { label: "Audit log", href: "/app/settings/audit" },
    ],
  },
  {
    title: "Product",
    links: [
      { label: "Geofencing", href: "#geofencing" },
      { label: "Task board", href: "#tasks" },
      { label: "Analytics", href: "#analytics" },
      { label: "Health check", href: "/api/health" },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="border-t border-line bg-surface-1/50 px-5 py-14 sm:px-8">
      <div className="mx-auto grid w-full max-w-7xl gap-10 lg:grid-cols-[1.5fr_2fr]">
        <div className="min-w-0">
          <Link href="/" className="flex w-fit items-center gap-2.5">
            <Logo className="size-8" />
            <span className="text-[0.9375rem] font-semibold tracking-tight text-ink">{branding.name}</span>
          </Link>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-ink-muted">{branding.description}</p>
        </div>

        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title} className="min-w-0">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                {column.title}
              </h3>
              <ul className="mt-4 flex flex-col gap-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="rounded text-sm text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto mt-12 flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
        <p className="text-xs text-ink-muted">
          {branding.name} — working name. Built as a multi-tenant SaaS platform.
        </p>
        <p className="text-xs text-ink-muted">Next.js · PostgreSQL · Railway</p>
      </div>
    </footer>
  );
}
