import {
  BarChart3,
  Bell,
  Building2,
  CalendarCheck,
  LayoutDashboard,
  ListTodo,
  Settings,
  ShieldCheck,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import type { Permission } from "@/server/auth/permissions";

/**
 * The single navigation definition, shared by the desktop sidebar, the mobile
 * drawer and the bottom tab bar — so a route can never appear in one and not
 * the others.
 *
 * `permission` hides an item the user cannot use. That is a *cosmetic* filter:
 * the route itself is still guarded server-side, because hiding a link is not
 * access control.
 */

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission?: Permission;
  /** Also highlight this item for nested routes under `href`. */
  matchPrefix?: boolean;
  /** Shown in the mobile bottom bar (max five). */
  primary?: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Workspace",
    items: [
      { href: "/app", label: "Dashboard", icon: LayoutDashboard, primary: true },
      {
        href: "/app/tasks",
        label: "Tasks",
        icon: ListTodo,
        permission: "task:read",
        matchPrefix: true,
        primary: true,
      },
      {
        href: "/app/attendance/my",
        label: "My attendance",
        icon: CalendarCheck,
        permission: "attendance:read:self",
        primary: true,
      },
    ],
  },
  {
    title: "People",
    items: [
      {
        href: "/app/employees",
        label: "Employees",
        icon: Users,
        permission: "employee:read",
        matchPrefix: true,
        primary: true,
      },
      { href: "/app/teams", label: "Teams", icon: UsersRound, permission: "team:read", matchPrefix: true },
      {
        href: "/app/attendance",
        label: "Attendance",
        icon: CalendarCheck,
        permission: "attendance:read:team",
      },
    ],
  },
  {
    title: "Organisation",
    items: [
      {
        href: "/app/locations",
        label: "Locations",
        icon: Building2,
        permission: "office:read",
        matchPrefix: true,
      },
      { href: "/app/reports", label: "Reports", icon: BarChart3, permission: "report:read" },
      { href: "/app/notifications", label: "Notifications", icon: Bell },
      {
        href: "/app/settings/access",
        label: "Users & access",
        icon: ShieldCheck,
        permission: "user:read",
      },
      { href: "/app/settings", label: "Settings", icon: Settings, matchPrefix: true },
    ],
  },
];

/** Flatten to the items a given permission set may see. */
export function visibleSections(can: (permission: Permission) => boolean): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.permission || can(item.permission)),
  })).filter((section) => section.items.length > 0);
}

/** Up to five items for the mobile bottom bar. */
export function primaryNavItems(can: (permission: Permission) => boolean): NavItem[] {
  return NAV_SECTIONS.flatMap((section) => section.items)
    .filter((item) => item.primary && (!item.permission || can(item.permission)))
    .slice(0, 5);
}

function matches(pathname: string, item: NavItem): boolean {
  if (item.href === "/app") return pathname === "/app";
  if (item.matchPrefix) return pathname === item.href || pathname.startsWith(`${item.href}/`);
  return pathname === item.href;
}

/**
 * Whether `pathname` should mark `item` as current.
 *
 * Longest match wins. Without that, a prefix-matching parent stays highlighted
 * on its own children: `/app/settings` has `matchPrefix`, so on
 * `/app/settings/access` both it and the more specific "Users & access" item
 * would claim to be current, and a sidebar with two highlighted rows tells the
 * reader nothing about where they are.
 */
export function isActive(pathname: string, item: NavItem): boolean {
  if (!matches(pathname, item)) return false;

  return !NAV_SECTIONS.some(
    (section) =>
      section.items.some(
        (other) => other.href.length > item.href.length && matches(pathname, other),
      ),
  );
}
