import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

import "./globals.css";

import { branding } from "@/lib/branding";
import { Providers } from "@/components/providers";

/**
 * `display: "swap"` renders the fallback immediately rather than blocking
 * first paint on the webfont; the CSS variables here are what
 * `--font-sans` / `--font-mono` in globals.css resolve to.
 */
const sans = Inter({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(branding.appUrl),
  title: {
    default: `${branding.name} — ${branding.tagline}`,
    template: `%s · ${branding.name}`,
  },
  description: branding.description,
  applicationName: branding.name,
  openGraph: {
    type: "website",
    siteName: branding.name,
    title: `${branding.name} — ${branding.tagline}`,
    description: branding.description,
    url: branding.appUrl,
  },
  twitter: { card: "summary_large_image", title: branding.name, description: branding.description },
  robots: { index: true, follow: true },
  icons: {
    // Inline SVG favicon: no extra network request, and it inherits the brand
    // gradient without shipping a binary asset.
    icon: [
      {
        url:
          "data:image/svg+xml," +
          encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f46e5"/><stop offset="0.5" stop-color="#8b5cf6"/><stop offset="1" stop-color="#0ea5e9"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#g)"/><path d="M9 16.5l4.5 4.5L23 11.5" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`,
          ),
        type: "image/svg+xml",
      },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pinch-zoom stays available — capping it would fail WCAG 1.4.4.
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7fb" },
    { media: "(prefers-color-scheme: dark)", color: "#080a14" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh bg-canvas font-sans text-ink antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
