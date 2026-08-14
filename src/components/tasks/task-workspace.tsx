"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, KanbanSquare, List, ListTodo, Plus, Search } from "lucide-react";

import { TASK_PRIORITY_LABELS, TASK_STATUS_LABELS } from "@/lib/validation/task";
import type { TaskSummary } from "@/server/repositories/task-repository";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState, NoResultsState } from "@/components/ui/states";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskCalendar } from "@/components/tasks/task-calendar";
import { TaskListItem } from "@/components/tasks/task-list-item";

/**
 * The tasks workspace: one dataset, three views.
 *
 * View choice and filters both live in the URL, so a board filtered to
 * "urgent, my tasks" is a link someone can send to a colleague. The three
 * views share the fetched list rather than each querying separately.
 */

const ALL = "__all__";

export function TaskWorkspace({
  tasks,
  teams,
  canCreate,
}: {
  tasks: TaskSummary[];
  teams: Array<{ id: string; name: string; color: string }>;
  canCreate: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const view = searchParams.get("view") ?? "board";
  const scope = searchParams.get("scope") ?? "all";
  const status = searchParams.get("status") ?? ALL;
  const priority = searchParams.get("priority") ?? ALL;
  const teamId = searchParams.get("teamId") ?? ALL;
  const search = searchParams.get("search") ?? "";

  const [searchValue, setSearchValue] = React.useState(search);
  const [pending, startTransition] = React.useTransition();

  const setParam = React.useCallback(
    (updates: Record<string, string | undefined>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (!value || value === ALL) next.delete(key);
        else next.set(key, value);
      }
      startTransition(() => router.push(`${pathname}?${next.toString()}`, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  React.useEffect(() => {
    if (searchValue === search) return;
    const timer = window.setTimeout(() => setParam({ search: searchValue || undefined }), 350);
    return () => window.clearTimeout(timer);
  }, [searchValue, search, setParam]);

  const hasFilters = Boolean(search || status !== ALL || priority !== ALL || teamId !== ALL);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[11rem] flex-1 sm:max-w-xs">
          <Input
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="Search tasks…"
            leadingIcon={<Search />}
            aria-label="Search tasks"
          />
        </div>

        <Select value={scope} onValueChange={(value) => setParam({ scope: value })}>
          <SelectTrigger className="w-auto min-w-[8.5rem]" aria-label="Filter by scope">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tasks</SelectItem>
            <SelectItem value="mine">My tasks</SelectItem>
            <SelectItem value="created">Created by me</SelectItem>
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={(value) => setParam({ status: value })}>
          <SelectTrigger className="w-auto min-w-[8.5rem]" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {Object.entries(TASK_STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={priority} onValueChange={(value) => setParam({ priority: value })}>
          <SelectTrigger className="w-auto min-w-[8rem]" aria-label="Filter by priority">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All priorities</SelectItem>
            {Object.entries(TASK_PRIORITY_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {teams.length > 0 ? (
          <Select value={teamId} onValueChange={(value) => setParam({ teamId: value })}>
            <SelectTrigger className="w-auto min-w-[8.5rem]" aria-label="Filter by team">
              <SelectValue placeholder="Team" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All teams</SelectItem>
              {teams.map((team) => (
                <SelectItem key={team.id} value={team.id}>
                  {team.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        {canCreate ? (
          <Button size="sm" className="ml-auto" asChild>
            <Link href="/app/tasks/new">
              <Plus aria-hidden />
              New task
            </Link>
          </Button>
        ) : null}
      </div>

      <Tabs value={view} onValueChange={(value) => setParam({ view: value })}>
        <TabsList>
          <TabsTrigger value="board">
            <KanbanSquare aria-hidden />
            Board
          </TabsTrigger>
          <TabsTrigger value="list">
            <List aria-hidden />
            List
          </TabsTrigger>
          <TabsTrigger value="calendar">
            <CalendarDays aria-hidden />
            Calendar
          </TabsTrigger>
        </TabsList>

        <div className={pending ? "opacity-70 transition-opacity" : undefined}>
          <TabsContent value="board">
            {tasks.length === 0 ? (
              <Card>
                <EmptyContent hasFilters={hasFilters} search={search} onClear={() => setParam({ search: undefined, status: ALL, priority: ALL, teamId: ALL })} canCreate={canCreate} />
              </Card>
            ) : (
              <TaskBoard tasks={tasks} />
            )}
          </TabsContent>

          <TabsContent value="list">
            <Card className="overflow-hidden">
              {tasks.length === 0 ? (
                <EmptyContent hasFilters={hasFilters} search={search} onClear={() => setParam({ search: undefined, status: ALL, priority: ALL, teamId: ALL })} canCreate={canCreate} />
              ) : (
                <ul className="divide-y divide-[var(--line)]">
                  {tasks.map((task) => (
                    <TaskListItem key={task.id} task={task} />
                  ))}
                </ul>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="calendar">
            {tasks.length === 0 ? (
              <Card>
                <EmptyContent hasFilters={hasFilters} search={search} onClear={() => setParam({ search: undefined, status: ALL, priority: ALL, teamId: ALL })} canCreate={canCreate} />
              </Card>
            ) : (
              <TaskCalendar tasks={tasks} />
            )}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function EmptyContent({
  hasFilters,
  search,
  onClear,
  canCreate,
}: {
  hasFilters: boolean;
  search: string;
  onClear: () => void;
  canCreate: boolean;
}) {
  if (hasFilters) return <NoResultsState query={search} onClear={onClear} />;

  return (
    <EmptyState
      icon={<ListTodo />}
      title="No tasks yet"
      description="Create the first task, or run the seed script to populate a demo backlog."
      action={
        canCreate ? (
          <Button size="sm" asChild>
            <Link href="/app/tasks/new">
              <Plus aria-hidden />
              New task
            </Link>
          </Button>
        ) : null
      }
    />
  );
}
