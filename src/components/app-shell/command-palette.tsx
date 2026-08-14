"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  CornerDownLeft,
  ListTodo,
  Loader2,
  Search,
  Users,
  UsersRound,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/**
 * ⌘K / Ctrl-K global search.
 *
 * Queries `/api/search`, which is tenant-scoped and narrows tasks to the
 * caller's visibility envelope — so the palette cannot surface anything the
 * corresponding list page would hide.
 *
 * Keyboard model: ↑/↓ move, Enter opens, Escape closes. The active row is
 * tracked as a flat index across all groups so arrow keys cross group
 * boundaries naturally.
 */

interface SearchResults {
  employees: Array<{ id: string; firstName: string; lastName: string; designation: string; avatarUrl: string | null }>;
  tasks: Array<{ id: string; reference: number; title: string; status: string; priority: string }>;
  teams: Array<{ id: string; name: string; color: string; _count: { members: number } }>;
  offices: Array<{ id: string; name: string; city: string }>;
}

interface FlatResult {
  key: string;
  href: string;
  label: string;
  sublabel: string;
  group: string;
  icon?: React.ReactNode;
}

const EMPTY: SearchResults = { employees: [], tasks: [], teams: [], offices: [] };

function flatten(results: SearchResults): FlatResult[] {
  return [
    ...results.employees.map((employee) => ({
      key: `employee-${employee.id}`,
      href: `/app/employees/${employee.id}`,
      label: `${employee.firstName} ${employee.lastName}`,
      sublabel: employee.designation,
      group: "People",
      icon: (
        <Avatar
          name={`${employee.firstName} ${employee.lastName}`}
          src={employee.avatarUrl}
          size="xs"
        />
      ),
    })),
    ...results.tasks.map((task) => ({
      key: `task-${task.id}`,
      href: `/app/tasks/${task.id}`,
      label: task.title,
      sublabel: `TF-${task.reference} · ${task.status.replace("_", " ").toLowerCase()}`,
      group: "Tasks",
      icon: <ListTodo className="size-4 text-ink-muted" aria-hidden />,
    })),
    ...results.teams.map((team) => ({
      key: `team-${team.id}`,
      href: `/app/teams`,
      label: team.name,
      sublabel: `${team._count.members} members`,
      group: "Teams",
      icon: <UsersRound className="size-4 text-ink-muted" aria-hidden />,
    })),
    ...results.offices.map((office) => ({
      key: `office-${office.id}`,
      href: `/app/locations`,
      label: office.name,
      sublabel: office.city,
      group: "Locations",
      icon: <Building2 className="size-4 text-ink-muted" aria-hidden />,
    })),
  ];
}

const QUICK_LINKS: FlatResult[] = [
  { key: "quick-dashboard", href: "/app", label: "Dashboard", sublabel: "Today at a glance", group: "Go to" },
  { key: "quick-tasks", href: "/app/tasks", label: "Tasks", sublabel: "Board and list views", group: "Go to" },
  { key: "quick-people", href: "/app/employees", label: "Employees", sublabel: "Directory", group: "Go to" },
  { key: "quick-attendance", href: "/app/attendance/my", label: "My attendance", sublabel: "Check in and history", group: "Go to" },
  { key: "quick-locations", href: "/app/locations", label: "Locations", sublabel: "Offices and geofences", group: "Go to" },
];

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResults>(EMPTY);
  const [loading, setLoading] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);

  const items = React.useMemo(
    () => (query.trim().length === 0 ? QUICK_LINKS : flatten(results)),
    [query, results],
  );

  // Debounced fetch. The abort controller drops a response that arrives after
  // the user has typed further, so results can never appear out of order.
  React.useEffect(() => {
    const term = query.trim();
    if (term.length === 0) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("search failed");
        const payload = (await response.json()) as { data: SearchResults };
        setResults(payload.data);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setResults(EMPTY);
      } finally {
        setLoading(false);
      }
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query]);

  React.useEffect(() => setActiveIndex(0), [items.length]);

  React.useEffect(() => {
    if (!open) {
      setQuery("");
      setResults(EMPTY);
    }
  }, [open]);

  const go = React.useCallback(
    (href: string) => {
      onOpenChange(false);
      router.push(href);
    },
    [onOpenChange, router],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (items.length === 0 ? 0 : (index + 1) % items.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (items.length === 0 ? 0 : (index - 1 + items.length) % items.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = items[activeIndex];
      if (target) go(target.href);
    }
  };

  // Group while preserving the flat index used for keyboard navigation.
  const grouped = React.useMemo(() => {
    const map = new Map<string, Array<{ item: FlatResult; index: number }>>();
    items.forEach((item, index) => {
      const bucket = map.get(item.group) ?? [];
      bucket.push({ item, index });
      map.set(item.group, bucket);
    });
    return Array.from(map.entries());
  }, [items]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" hideClose className="sm:top-[18%] sm:translate-y-0">
        <DialogTitle className="sr-only">Search {""}</DialogTitle>

        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 shrink-0 text-ink-muted" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search people, tasks, teams and offices…"
            aria-label="Search"
            className="h-14 w-full min-w-0 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
          />
          {loading ? <Loader2 className="size-4 shrink-0 animate-spin text-ink-muted" aria-hidden /> : null}
          <kbd className="hidden shrink-0 rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[0.625rem] font-medium text-ink-muted sm:inline-block">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[22rem] overflow-y-auto p-2">
          {items.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-ink-muted">
              {loading ? "Searching…" : `Nothing matched “${query}”.`}
            </p>
          ) : (
            grouped.map(([group, entries]) => (
              <div key={group} className="mb-2 last:mb-0">
                <p className="px-3 py-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-muted">
                  {group}
                </p>
                <ul>
                  {entries.map(({ item, index }) => (
                    <li key={item.key}>
                      <button
                        type="button"
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => go(item.href)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                          index === activeIndex ? "bg-surface-2" : "hover:bg-surface-2/60",
                        )}
                      >
                        <span className="flex size-6 shrink-0 items-center justify-center">
                          {item.icon ?? <Users className="size-4 text-ink-muted" aria-hidden />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">{item.label}</span>
                          <span className="block truncate text-xs text-ink-muted">{item.sublabel}</span>
                        </span>
                        {index === activeIndex ? (
                          <CornerDownLeft className="size-3.5 shrink-0 text-ink-muted" aria-hidden />
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Registers the ⌘K / Ctrl-K shortcut and owns the palette's open state. */
export function useCommandPalette() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return { open, setOpen };
}
