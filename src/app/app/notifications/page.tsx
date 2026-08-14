import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";

import { formatDateTime, formatRelative } from "@/lib/time";
import { cn } from "@/lib/utils";
import { requireSession } from "@/server/auth";
import { NOTIFICATION_ICON_TONE, notificationService } from "@/server/services/notification-service";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { PageBody, PageHeader } from "@/components/ui/page-header";
import { MarkAllReadButton } from "@/components/notifications/mark-all-read";

export const metadata: Metadata = { title: "Notifications" };

const TONE_CLASSES = {
  brand: "bg-brand-soft text-brand",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  critical: "bg-critical-soft text-critical",
  info: "bg-info-soft text-info",
} as const;

/** The signed-in user's own notifications — scoped by user id, not by URL. */
export default async function NotificationsPage() {
  const session = await requireSession();
  const { items, unread } = await notificationService.listForSession(session, 60);

  return (
    <>
      <PageHeader
        title="Notifications"
        description={
          unread > 0 ? `${unread} unread of ${items.length}` : "You're all caught up."
        }
        actions={unread > 0 ? <MarkAllReadButton /> : null}
      />

      <PageBody>
        <Card className="overflow-hidden">
          {items.length === 0 ? (
            <EmptyState
              icon={<Bell />}
              size="page"
              title="Nothing here yet"
              description="Task assignments, comments, leave decisions and attendance reminders will appear here."
            />
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {items.map((notification) => {
                const tone = NOTIFICATION_ICON_TONE[notification.type];
                const content = (
                  <div
                    className={cn(
                      "flex gap-4 px-5 py-4 transition-colors sm:px-6",
                      notification.linkUrl && "hover:bg-surface-2/60",
                      !notification.readAt && "bg-brand-soft/25",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-lg",
                        TONE_CLASSES[tone],
                      )}
                      aria-hidden
                    >
                      <Bell className="size-[1.125rem]" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-ink">{notification.title}</p>
                        {!notification.readAt ? (
                          <Badge tone="brand" size="sm">
                            New
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-ink-secondary">
                        {notification.body}
                      </p>
                      <p className="mt-1.5 text-xs text-ink-muted">
                        <time dateTime={notification.createdAt.toISOString()}>
                          {formatRelative(notification.createdAt)}
                        </time>
                        <span className="mx-1.5" aria-hidden>
                          ·
                        </span>
                        {formatDateTime(notification.createdAt, session.organization.timezone)}
                      </p>
                    </div>
                  </div>
                );

                return (
                  <li key={notification.id}>
                    {notification.linkUrl ? (
                      <Link
                        href={notification.linkUrl}
                        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/50"
                      >
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </PageBody>
    </>
  );
}

export const dynamic = "force-dynamic";
