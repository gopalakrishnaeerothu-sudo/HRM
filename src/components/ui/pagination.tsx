"use client";

import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Pagination.
 *
 * The visible page list is a pure function so it can be tested directly — the
 * ellipsis rules are where this kind of component usually goes wrong (jumping
 * width as you page, or hiding the last page so there is no way to reach it).
 */

export const PAGE_RANGE_ELLIPSIS = "ellipsis" as const;

export type PageRangeItem = number | typeof PAGE_RANGE_ELLIPSIS;

/**
 * Page numbers to render, with gaps collapsed.
 *
 * Guarantees, in order of importance:
 *  - the first and last page are ALWAYS reachable, so no page is stranded;
 *  - the current page is always shown;
 *  - the returned length is stable while paging through the middle, so the
 *    control does not change width under the pointer as you click.
 *
 * `siblings` is how many pages to show either side of the current one.
 */
export function buildPageRange(
  currentPage: number,
  totalPages: number,
  siblings = 1,
): PageRangeItem[] {
  if (totalPages <= 0) return [];

  const current = Math.min(Math.max(currentPage, 1), totalPages);

  // first + last + current + siblings either side + two ellipses
  const maxVisible = siblings * 2 + 5;

  if (totalPages <= maxVisible) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const leftSibling = Math.max(current - siblings, 1);
  const rightSibling = Math.min(current + siblings, totalPages);

  // A gap is only worth an ellipsis if it hides more than one page: replacing
  // a single hidden page with "…" costs the same width and loses a target.
  //
  // leftSibling must be at least 4 for pages 2 and 3 to be hidden — at 3 the
  // ellipsis would stand in for page 2 alone. Same reasoning on the right.
  const showLeftEllipsis = leftSibling > 3;
  const showRightEllipsis = rightSibling < totalPages - 2;

  if (!showLeftEllipsis && showRightEllipsis) {
    const count = siblings * 2 + 3;
    return [
      ...Array.from({ length: count }, (_, index) => index + 1),
      PAGE_RANGE_ELLIPSIS,
      totalPages,
    ];
  }

  if (showLeftEllipsis && !showRightEllipsis) {
    const count = siblings * 2 + 3;
    return [
      1,
      PAGE_RANGE_ELLIPSIS,
      ...Array.from({ length: count }, (_, index) => totalPages - count + 1 + index),
    ];
  }

  if (showLeftEllipsis && showRightEllipsis) {
    return [
      1,
      PAGE_RANGE_ELLIPSIS,
      ...Array.from(
        { length: rightSibling - leftSibling + 1 },
        (_, index) => leftSibling + index,
      ),
      PAGE_RANGE_ELLIPSIS,
      totalPages,
    ];
  }

  return Array.from({ length: totalPages }, (_, index) => index + 1);
}

/** "1–20 of 137" — the range actually on screen. */
export function describeRange(page: number, pageSize: number, total: number): string {
  if (total === 0) return "No results";

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return `${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}`;
}

const PAGE_SIZES = [10, 20, 50, 100] as const;

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  /** Labels the control for screen readers when a page has more than one. */
  label?: string;
  className?: string;
}

const controlBase =
  "inline-flex h-9 min-w-9 items-center justify-center rounded-lg border border-white/10 " +
  "bg-white/5 px-3 text-sm font-medium transition-colors " +
  "hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-indigo-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent " +
  "disabled:pointer-events-none disabled:opacity-40";

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  label = "Pagination",
  className,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(page, 1), totalPages);
  const items = buildPageRange(current, totalPages);

  return (
    <nav
      aria-label={label}
      className={cn(
        "flex flex-col gap-3 border-t border-white/10 pt-4",
        // Single column on narrow screens so nothing is squeezed; the summary
        // and controls sit on one row once there is room for both.
        "sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex items-center gap-3 text-sm text-white/60">
        <span aria-live="polite">{describeRange(current, pageSize, total)}</span>

        {onPageSizeChange ? (
          <label className="hidden items-center gap-2 md:flex">
            <span className="sr-only">Results per page</span>
            <select
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className={cn(controlBase, "cursor-pointer pr-2")}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size} className="bg-slate-900">
                  {size} / page
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {totalPages > 1 ? (
        <ul className="flex items-center gap-1">
          <li>
            <button
              type="button"
              onClick={() => onPageChange(current - 1)}
              disabled={current <= 1}
              aria-label="Previous page"
              className={controlBase}
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
          </li>

          {items.map((item, index) =>
            item === PAGE_RANGE_ELLIPSIS ? (
              <li
                // Two ellipses can coexist, so the index is part of the key.
                key={`gap-${index}`}
                aria-hidden
                className="inline-flex h-9 w-9 items-center justify-center text-white/40"
              >
                <MoreHorizontal className="h-4 w-4" />
              </li>
            ) : (
              <li key={item}>
                <button
                  type="button"
                  onClick={() => onPageChange(item)}
                  aria-label={`Page ${item}`}
                  aria-current={item === current ? "page" : undefined}
                  className={cn(
                    controlBase,
                    item === current &&
                      "border-indigo-400/60 bg-indigo-500/20 text-white shadow-[0_0_18px_-6px_rgb(99_102_241)]",
                  )}
                >
                  {item}
                </button>
              </li>
            ),
          )}

          <li>
            <button
              type="button"
              onClick={() => onPageChange(current + 1)}
              disabled={current >= totalPages}
              aria-label="Next page"
              className={controlBase}
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </li>
        </ul>
      ) : null}
    </nav>
  );
}
