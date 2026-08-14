import { cn } from "@/lib/utils";

/**
 * The product mark.
 *
 * Kept as one inline SVG with a gradient drawn from the brand tokens, so
 * re-branding is a token change rather than an asset swap. The `gradientId`
 * prop avoids duplicate ids when several logos render on one page.
 */
export function Logo({ className, gradientId = "logo-gradient" }: { className?: string; gradientId?: string }) {
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      aria-hidden
    >
      <svg viewBox="0 0 32 32" className="size-full" role="presentation">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#4f46e5" />
            <stop offset="50%" stopColor="#8b5cf6" />
            <stop offset="100%" stopColor="#0ea5e9" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="8.5" fill={`url(#${gradientId})`} />
        {/* Check mark + perimeter arc: task completion inside a geofence. */}
        <path
          d="M9 16.4l4.6 4.6L23 11.6"
          fill="none"
          stroke="white"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="16" cy="16" r="11.5" fill="none" stroke="white" strokeOpacity="0.35" strokeWidth="1.2" strokeDasharray="3 3" />
      </svg>
    </span>
  );
}

/** Logo plus wordmark, used in the sidebar and headers. */
export function LogoLockup({
  name,
  collapsed = false,
  className,
}: {
  name: string;
  collapsed?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <Logo className="size-8" />
      {collapsed ? null : (
        <span className="truncate text-[0.9375rem] font-semibold tracking-tight text-ink">{name}</span>
      )}
    </span>
  );
}
