"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlarmClock,
  BarChart3,
  CalendarClock,
  ClipboardList,
  Coffee,
  Flag,
  GaugeCircle,
  KanbanSquare,
  LogIn,
  LogOut,
  MapPinned,
  PieChart,
  TrendingUp,
  UserCog,
  Users2,
} from "lucide-react";

import { cn, formatMinutes } from "@/lib/utils";
import { AvatarGroup } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Progress, ProgressRing } from "@/components/ui/progress";
import { FeatureList, Reveal, Section, SectionHeading, SplitLayout } from "@/components/landing/section";

/* ========================================================================== */
/*  Task management                                                            */
/* ========================================================================== */

const BOARD = [
  {
    status: "To do",
    tone: "neutral" as const,
    cards: [
      { title: "Design the leave approval flow", priority: "HIGH" as const, due: "Fri", progress: 0, people: ["Priya Nair", "Rahul Verma"] },
      { title: "Audit login rate limits", priority: "MEDIUM" as const, due: "Mon", progress: 0, people: ["Vikram Rao"] },
    ],
  },
  {
    status: "In progress",
    tone: "info" as const,
    cards: [
      { title: "Payment retry queue", priority: "URGENT" as const, due: "Today", progress: 60, people: ["Ananya Iyer"] },
      { title: "Onboarding email sequence", priority: "MEDIUM" as const, due: "Wed", progress: 35, people: ["Sneha Patel", "Arjun Das"] },
    ],
  },
  {
    status: "Completed",
    tone: "success" as const,
    cards: [
      { title: "Geofence radius settings UI", priority: "HIGH" as const, due: "Done", progress: 100, people: ["Karthik Menon"] },
    ],
  },
];

const PRIORITY_TONE = {
  URGENT: "critical",
  HIGH: "warning",
  MEDIUM: "info",
  LOW: "neutral",
} as const;

function KanbanPreview() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="glass-card p-4 sm:p-5">
      <div className="scrollbar-none flex gap-3 overflow-x-auto pb-1">
        {BOARD.map((column, columnIndex) => (
          <div key={column.status} className="flex w-[15.5rem] shrink-0 flex-col gap-3">
            <div className="flex items-center justify-between gap-2 px-1">
              <div className="flex items-center gap-2">
                <Badge tone={column.tone} size="sm">
                  {column.status}
                </Badge>
              </div>
              <span className="text-xs tabular text-ink-muted">{column.cards.length}</span>
            </div>

            {column.cards.map((card, cardIndex) => (
              <motion.article
                key={card.title}
                initial={reduceMotion ? false : { opacity: 0, y: 14 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{
                  duration: 0.45,
                  delay: columnIndex * 0.1 + cardIndex * 0.08,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="rounded-xl border border-line bg-surface-1 p-3.5 shadow-soft"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="line-clamp-2-safe text-sm font-medium leading-snug text-ink">
                    {card.title}
                  </p>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Badge tone={PRIORITY_TONE[card.priority]} size="sm">
                    <Flag className="size-2.5" aria-hidden />
                    {card.priority.charAt(0) + card.priority.slice(1).toLowerCase()}
                  </Badge>
                  <Badge tone="outline" size="sm">
                    <CalendarClock className="size-2.5" aria-hidden />
                    {card.due}
                  </Badge>
                </div>

                {card.progress > 0 ? (
                  <div className="mt-3">
                    <div className="mb-1.5 flex items-center justify-between text-[0.6875rem] text-ink-muted">
                      <span>Progress</span>
                      <span className="tabular">{card.progress}%</span>
                    </div>
                    <Progress
                      value={card.progress}
                      barSize="sm"
                      tone={card.progress === 100 ? "success" : "brand"}
                      label={`${card.title} progress`}
                    />
                  </div>
                ) : null}

                <div className="mt-3 flex items-center justify-between">
                  <AvatarGroup
                    size="xs"
                    people={card.people.map((name) => ({ id: name, name }))}
                  />
                </div>
              </motion.article>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TasksSection() {
  return (
    <Section id="tasks">
      <SplitLayout media={<KanbanPreview />} reverse>
        <SectionHeading
          align="left"
          eyebrow="Task management"
          eyebrowIcon={KanbanSquare}
          title="A board your team will actually keep updated"
          description="List, board and calendar views over the same tasks. Priorities, progress, deadlines and owners — with a full activity trail on every card."
        />
        <FeatureList
          items={[
            {
              icon: ClipboardList,
              title: "Five statuses, four priorities",
              body: "To do, in progress, in review, blocked and completed. Progress stays in step with status automatically.",
            },
            {
              icon: Users2,
              title: "Assign to people or a team",
              body: "Several assignees per task with one accountable owner, so nothing sits in a vacuum.",
            },
            {
              icon: TrendingUp,
              title: "Every change is history",
              body: "Who created it, who picked it up, when progress moved and what was said — reconstructable from the timeline.",
            },
          ]}
        />
      </SplitLayout>
    </Section>
  );
}

/* ========================================================================== */
/*  Attendance                                                                 */
/* ========================================================================== */

const TIMELINE = [
  { icon: LogIn, label: "Checked in", time: "09:14 AM", detail: "Guntur HQ · verified 42 m", tone: "success" as const },
  { icon: Coffee, label: "Break", time: "01:02 PM", detail: "38 minutes", tone: "info" as const },
  { icon: LogOut, label: "Checked out", time: "06:22 PM", detail: "8h 30m worked", tone: "brand" as const },
];

const TONE_BG = {
  success: "bg-success-soft text-success",
  info: "bg-info-soft text-info",
  brand: "bg-brand-soft text-brand",
} as const;

function AttendancePreview() {
  return (
    <div className="glass-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Today&apos;s attendance</p>
          <p className="mt-0.5 text-xs text-ink-muted">Friday, 08 August</p>
        </div>
        <Badge tone="success">
          <span className="size-1.5 rounded-full bg-current" aria-hidden />
          Present
        </Badge>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-6">
        <ProgressRing value={94} size={128} strokeWidth={11} tone="success" label="Hours completed today">
          <p className="text-xl font-semibold tracking-tight text-ink">{formatMinutes(510)}</p>
          <p className="text-[0.6875rem] text-ink-muted">of 9h target</p>
        </ProgressRing>

        <dl className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-4">
          {[
            { label: "This week", value: formatMinutes(2415) },
            { label: "Overtime", value: formatMinutes(45) },
            { label: "Late arrivals", value: "1 day" },
            { label: "Attendance", value: "96%" },
          ].map((stat) => (
            <div key={stat.label} className="min-w-0">
              <dt className="text-[0.6875rem] text-ink-muted">{stat.label}</dt>
              <dd className="mt-0.5 text-base font-semibold tabular text-ink">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <ol className="mt-6 flex flex-col gap-3 border-t border-line pt-5">
        {TIMELINE.map((entry) => (
          <li key={entry.label} className="flex items-center gap-3">
            <span
              className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", TONE_BG[entry.tone])}
              aria-hidden
            >
              <entry.icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{entry.label}</p>
              <p className="truncate text-xs text-ink-muted">{entry.detail}</p>
            </div>
            <p className="shrink-0 text-xs tabular text-ink-secondary">{entry.time}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function AttendanceSection() {
  return (
    <Section id="attendance">
      <SplitLayout media={<AttendancePreview />}>
        <SectionHeading
          align="left"
          eyebrow="Attendance"
          eyebrowIcon={AlarmClock}
          title="Hours that add up, without the spreadsheet"
          description="Check-in, breaks and check-out roll into worked hours, overtime and late arrivals — computed against each office's own working window and timezone."
        />
        <FeatureList
          items={[
            {
              icon: MapPinned,
              title: "Verified at the door",
              body: "Each check-in stores which office matched, how far away the person was, and how accurate the reading claimed to be.",
            },
            {
              icon: GaugeCircle,
              title: "Late is a policy, not a guess",
              body: "Grace period, half-day threshold and full-day hours are settings — and they can differ per office or per person's shift.",
            },
            {
              icon: UserCog,
              title: "Corrections leave a trace",
              body: "HR can fix a missed check-out, but only with a reason, and the edit lands in the audit log with their name on it.",
            },
          ]}
        />
      </SplitLayout>
    </Section>
  );
}

/* ========================================================================== */
/*  Teams                                                                      */
/* ========================================================================== */

const TEAM_ROWS = [
  { name: "Frontend Team", members: ["Priya Nair", "Arjun Das", "Sneha Patel", "Karthik Menon", "Divya Rao"], load: 78, tone: "brand" as const },
  { name: "Backend Team", members: ["Rahul Verma", "Ananya Iyer", "Vikram Rao", "Meera Joshi"], load: 92, tone: "warning" as const },
  { name: "Marketing Team", members: ["Nikhil Shah", "Tara Bose", "Ishaan Gupta"], load: 54, tone: "info" as const },
  { name: "HR Team", members: ["Lakshmi Reddy", "Farhan Khan"], load: 41, tone: "success" as const },
];

function TeamsPreview() {
  return (
    <div className="glass-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <p className="text-sm font-semibold text-ink">Teams</p>
        <p className="text-xs text-ink-muted">4 teams · 14 people</p>
      </div>
      <ul className="divide-y divide-[var(--line)]">
        {TEAM_ROWS.map((team) => (
          <li key={team.name} className="flex flex-wrap items-center gap-4 px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{team.name}</p>
              <p className="mt-0.5 text-xs text-ink-muted">{team.members.length} members</p>
            </div>

            <AvatarGroup
              size="sm"
              max={4}
              people={team.members.map((name) => ({ id: name, name }))}
            />

            <div className="w-full sm:w-32">
              <div className="mb-1 flex items-center justify-between text-[0.6875rem]">
                <span className="text-ink-muted">Workload</span>
                <span className="tabular text-ink-secondary">{team.load}%</span>
              </div>
              <Progress value={team.load} barSize="sm" tone={team.tone} label={`${team.name} workload`} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TeamsSection() {
  return (
    <Section id="teams">
      <SplitLayout media={<TeamsPreview />} reverse>
        <SectionHeading
          align="left"
          eyebrow="Teams"
          eyebrowIcon={Users2}
          title="See where the work is piling up"
          description="Teams carry a manager, a department and a roster. Workload, attendance and open tasks roll up per team, so an overloaded group is obvious before it becomes a problem."
        />
        <FeatureList
          items={[
            {
              icon: Users2,
              title: "Managers see their own tree",
              body: "A manager's view covers their direct reports, their reports' reports, and the teams they run — and stops there.",
            },
            {
              icon: BarChart3,
              title: "Workload you can compare",
              body: "Open tasks per person and per team, side by side, so reassignment is a decision rather than a hunch.",
            },
          ]}
        />
      </SplitLayout>
    </Section>
  );
}

/* ========================================================================== */
/*  Analytics                                                                  */
/* ========================================================================== */

const TREND = [
  { label: "Mon", present: 88, late: 6 },
  { label: "Tue", present: 92, late: 4 },
  { label: "Wed", present: 85, late: 9 },
  { label: "Thu", present: 94, late: 3 },
  { label: "Fri", present: 91, late: 5 },
  { label: "Sat", present: 46, late: 2 },
  { label: "Sun", present: 12, late: 0 },
];

const DEPARTMENTS = [
  { name: "Engineering", value: 42, color: "var(--series-1)" },
  { name: "Marketing", value: 18, color: "var(--series-2)" },
  { name: "Sales", value: 22, color: "var(--series-3)" },
  { name: "HR", value: 10, color: "var(--series-4)" },
  { name: "Finance", value: 8, color: "var(--series-5)" },
];

function AnalyticsPreview() {
  const reduceMotion = useReducedMotion();
  const maxValue = 100;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="glass-card p-5 sm:col-span-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-ink">Attendance this week</p>
          {/* Legend is always present for two series — identity is never colour-only. */}
          <div className="flex items-center gap-4 text-[0.6875rem] text-ink-muted">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[2px] bg-[var(--series-1)]" aria-hidden />
              Present
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-[2px] bg-[var(--series-2)]" aria-hidden />
              Late
            </span>
          </div>
        </div>

        <div className="mt-5 flex h-36 items-end gap-2.5">
          {TREND.map((day, index) => (
            <div key={day.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              {/* 2px gap between stacked segments, per the chart spec. */}
              <div className="flex w-full flex-1 flex-col justify-end gap-[2px]">
                <motion.div
                  className="w-full rounded-t-[4px] bg-[var(--series-2)]"
                  initial={reduceMotion ? false : { height: 0 }}
                  whileInView={{ height: `${(day.late / maxValue) * 100}%` }}
                  viewport={{ once: true, amount: 0.4 }}
                  transition={{ duration: 0.55, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
                  style={reduceMotion ? { height: `${(day.late / maxValue) * 100}%` } : undefined}
                />
                <motion.div
                  className="w-full bg-[var(--series-1)]"
                  initial={reduceMotion ? false : { height: 0 }}
                  whileInView={{ height: `${(day.present / maxValue) * 100}%` }}
                  viewport={{ once: true, amount: 0.4 }}
                  transition={{ duration: 0.55, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
                  style={reduceMotion ? { height: `${(day.present / maxValue) * 100}%` } : undefined}
                />
              </div>
              <span className="text-[0.625rem] text-ink-muted">{day.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-card p-5">
        <p className="text-sm font-semibold text-ink">Head count by department</p>
        <ul className="mt-4 flex flex-col gap-3">
          {DEPARTMENTS.map((department) => (
            <li key={department.name}>
              <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-[2px]"
                    style={{ background: department.color }}
                    aria-hidden
                  />
                  <span className="truncate text-ink-secondary">{department.name}</span>
                </span>
                {/* Direct label: the value never relies on the colour alone. */}
                <span className="shrink-0 tabular text-ink">{department.value}</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(department.value / 42) * 100}%`, background: department.color }}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="glass-card flex flex-col justify-between p-5">
        <p className="text-sm font-semibold text-ink">Task completion</p>
        <div className="flex flex-1 items-center justify-center py-4">
          <ProgressRing value={87} size={120} strokeWidth={11} tone="brand" label="Task completion rate">
            <p className="text-2xl font-semibold tracking-tight text-ink">87%</p>
            <p className="text-[0.6875rem] text-ink-muted">completed</p>
          </ProgressRing>
        </div>
        <p className="text-xs text-ink-muted">129 of 148 tasks closed in the last 30 days.</p>
      </div>
    </div>
  );
}

export function AnalyticsSection() {
  return (
    <Section id="analytics">
      <SectionHeading
        eyebrow="Analytics"
        eyebrowIcon={PieChart}
        title="Reports that answer a question"
        description="Attendance trends, task throughput, working hours and team workload — scoped to whatever the person looking at them is allowed to see."
      />
      <Reveal delay={0.1} className="mt-12">
        <AnalyticsPreview />
      </Reveal>
    </Section>
  );
}
