
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { branding } from "@/lib/branding";
import { isProduction, serverEnv } from "@/lib/env";
import { getSession } from "@/server/auth";
import { PERMISSIONS, type Permission } from "@/server/auth/permissions";
import { hasPermission } from "@/server/auth/permissions";
import { notificationService } from "@/server/services/notification-service";
import { Sidebar } from "@/components/app-shell/sidebar";
import { Topbar } from "@/components/app-shell/topbar";
import { MobileBottomBar } from "@/components/app-shell/mobile-nav";

/**
 * Authenticated application shell.
 *
 * This layout is the single place the session is resolved for the whole `/app`
 * subtree; `getSession` is React-cached, so the pages beneath it reuse the same
 * lookup rather than issuing their own.
 *
 * The permission list is flattened here and passed to the client navigation.
 * That is presentation only — it decides which links are *drawn*. Each route
 * and each API handler re-checks server-side, because a hidden link is not a
 * security boundary.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  if (!session) {
    /**
     * Anonymous: bounce to the sign-in page, server-side, before any child
     * route runs. `redirect()` throws, so nothing below this line executes and
     * no protected markup is ever generated — which is what makes this a real
     * boundary rather than a client-side redirect someone can skip.
     *
     * The originating path is preserved so the user lands where they meant to
     * go; `safeRedirect` on the way back rejects anything that is not a local
     * path, so this cannot become an open redirect.
     */
    const headerList = await headers();
    const attempted = headerList.get("x-invoke-path") ?? headerList.get("x-pathname");
    const next = attempted && attempted.startsWith("/app") ? `?next=${encodeURIComponent(attempted)}` : "";

    redirect(`/login${next}`);
  }

  const grantedPermissions: Permission[] = PERMISSIONS.filter((permission) =>
    hasPermission(session.user.role, permission, session.permissionOverrides),
  );

  const { unread } = await notificationService.listForSession(session, 1);

  const devAuthEnabled = !isProduction && serverEnv().DEV_AUTH_ENABLED;

  return (
    <div className="flex min-h-dvh">
      <Sidebar
        permissions={grantedPermissions}
        organizationName={session.organization.name}
        productName={branding.name}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          user={{
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
            avatarUrl: session.user.avatarUrl,
            role: session.user.role,
            designation: session.employee?.designation ?? null,
          }}
          organizationName={session.organization.name}
          productName={branding.name}
          permissions={grantedPermissions}
          unreadCount={unread}
          devAuthEnabled={devAuthEnabled}
        />

        <main
          id="main-content"
          // The bottom padding clears the mobile tab bar; it collapses on lg
          // where the bar is not rendered.
          className="min-w-0 flex-1 px-3 pb-[calc(var(--spacing-mobilenav)+1rem)] pt-5 sm:px-5 lg:pb-8 lg:pr-6"
        >
          <div className="mx-auto w-full max-w-[100rem]">{children}</div>
        </main>
      </div>

      <MobileBottomBar permissions={grantedPermissions} />
    </div>
  );
}

/** Keeps `/app/…` out of search results even if it is publicly reachable. */
export const metadata = {
  robots: { index: false, follow: false },
};

/**
 * Every page under `/app` resolves a session from request cookies, so none of
 * them can be prerendered at build time. Declaring it once on the layout
 * covers the whole subtree — including future routes, which would otherwise
 * fail the build the first time someone forgot the per-page export.
 */
export const dynamic = "force-dynamic";
