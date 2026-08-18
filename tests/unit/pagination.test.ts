import { describe, expect, it } from "vitest";

import {
  buildPageRange,
  describeRange,
  PAGE_RANGE_ELLIPSIS,
} from "@/components/ui/pagination";

describe("buildPageRange", () => {
  it("lists every page when they all fit", () => {
    expect(buildPageRange(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(buildPageRange(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("always keeps the first and last page reachable", () => {
    for (const page of [1, 5, 25, 50, 99, 100]) {
      const range = buildPageRange(page, 100);
      expect(range[0]).toBe(1);
      expect(range.at(-1)).toBe(100);
    }
  });

  it("always includes the current page", () => {
    for (let page = 1; page <= 40; page += 1) {
      expect(buildPageRange(page, 40)).toContain(page);
    }
  });

  it("keeps a stable width while paging through the middle", () => {
    // A control that changes width as you click moves the target out from
    // under the pointer.
    const widths = new Set<number>();
    for (let page = 4; page <= 37; page += 1) {
      widths.add(buildPageRange(page, 40).length);
    }
    expect(widths.size).toBe(1);
  });

  it("opens with a trailing gap only", () => {
    expect(buildPageRange(1, 40)).toEqual([1, 2, 3, 4, 5, PAGE_RANGE_ELLIPSIS, 40]);
  });

  it("closes with a leading gap only", () => {
    expect(buildPageRange(40, 40)).toEqual([1, PAGE_RANGE_ELLIPSIS, 36, 37, 38, 39, 40]);
  });

  it("shows both gaps in the middle", () => {
    expect(buildPageRange(20, 40)).toEqual([
      1,
      PAGE_RANGE_ELLIPSIS,
      19,
      20,
      21,
      PAGE_RANGE_ELLIPSIS,
      40,
    ]);
  });

  it("never hides a single page behind an ellipsis", () => {
    // "…" standing in for one page costs the same width and loses a target.
    for (let page = 1; page <= 30; page += 1) {
      const range = buildPageRange(page, 30);

      range.forEach((item, index) => {
        if (item !== PAGE_RANGE_ELLIPSIS) return;
        const before = range[index - 1];
        const after = range[index + 1];
        if (typeof before === "number" && typeof after === "number") {
          expect(after - before).toBeGreaterThan(2);
        }
      });
    }
  });

  it("never repeats a page number", () => {
    for (let page = 1; page <= 60; page += 1) {
      const numbers = buildPageRange(page, 60).filter(
        (item): item is number => item !== PAGE_RANGE_ELLIPSIS,
      );
      expect(new Set(numbers).size).toBe(numbers.length);
    }
  });

  it("stays ascending", () => {
    for (let page = 1; page <= 60; page += 1) {
      const numbers = buildPageRange(page, 60).filter(
        (item): item is number => item !== PAGE_RANGE_ELLIPSIS,
      );
      expect([...numbers].sort((a, b) => a - b)).toEqual(numbers);
    }
  });

  it("handles the degenerate cases without throwing", () => {
    expect(buildPageRange(1, 0)).toEqual([]);
    expect(buildPageRange(1, 1)).toEqual([1]);
    // A page beyond the end clamps rather than producing a stranded range.
    expect(buildPageRange(99, 3)).toEqual([1, 2, 3]);
    expect(buildPageRange(-5, 3)).toEqual([1, 2, 3]);
  });

  it("widens with more siblings", () => {
    expect(buildPageRange(20, 40, 2)).toEqual([
      1,
      PAGE_RANGE_ELLIPSIS,
      18,
      19,
      20,
      21,
      22,
      PAGE_RANGE_ELLIPSIS,
      40,
    ]);
  });
});

describe("describeRange", () => {
  it("describes a full page", () => {
    expect(describeRange(1, 20, 137)).toBe("1–20 of 137");
    expect(describeRange(3, 20, 137)).toBe("41–60 of 137");
  });

  it("stops the last page at the total", () => {
    expect(describeRange(7, 20, 137)).toBe("121–137 of 137");
  });

  it("says so when there is nothing", () => {
    expect(describeRange(1, 20, 0)).toBe("No results");
  });

  it("handles a single result", () => {
    expect(describeRange(1, 20, 1)).toBe("1–1 of 1");
  });

  it("groups thousands so large counts stay readable", () => {
    expect(describeRange(1, 20, 12_345)).toBe("1–20 of 12,345");
  });
});
