"use client";

import * as React from "react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";

import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Client-side context shared by the whole app.
 *
 * `attribute="data-theme"` matters: globals.css defines its dark palette under
 * `:root[data-theme="dark"]`, and the Tailwind `dark:` variant is bound to the
 * same selector. next-themes resolves "system" to a concrete value, so the
 * attribute is always present after hydration.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <TooltipProvider delayDuration={250} skipDelayDuration={400}>
        {children}
        <Toaster
          position="bottom-right"
          expand={false}
          richColors={false}
          closeButton
          toastOptions={{
            // Toasts inherit the design tokens instead of sonner's defaults, so
            // they match the rest of the product in both themes.
            classNames: {
              toast:
                "!bg-surface-1 !border !border-line !text-ink !shadow-float !rounded-xl !font-sans",
              title: "!text-sm !font-medium !text-ink",
              description: "!text-xs !text-ink-muted",
              actionButton: "!bg-brand !text-white !rounded-lg",
              cancelButton: "!bg-surface-2 !text-ink-secondary !rounded-lg",
              success: "[&_[data-icon]]:!text-success",
              error: "[&_[data-icon]]:!text-critical",
              warning: "[&_[data-icon]]:!text-warning",
            },
          }}
        />
      </TooltipProvider>
    </ThemeProvider>
  );
}
