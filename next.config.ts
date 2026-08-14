import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * `standalone` emits a self-contained server bundle, which is what a slim
   * Dockerfile wants. It is opt-in because its build-trace step fails on
   * OneDrive-synced Windows folders, and Railway's default Nixpacks builder
   * does not need it — that path runs `npm run build` then `npm start`.
   * Set BUILD_STANDALONE=true when building a container image.
   */
  ...(process.env.BUILD_STANDALONE === "true" ? { output: "standalone" as const } : {}),
  poweredByHeader: false,
  eslint: {
    // Lint is a separate CI step (`npm run lint`) so a style nit never blocks
    // a deploy that type-checks and builds.
    ignoreDuringBuilds: true,
  },
  experimental: {
    // three.js and the chart library are large; transpiling them here lets
    // Next tree-shake across the package boundary.
    optimizePackageImports: ["lucide-react", "recharts", "date-fns"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            // Geolocation is required by attendance check-in, on this origin only.
            value: "geolocation=(self), camera=(), microphone=(), payment=()",
          },
        ],
      },
      {
        // Location data must never be cached by a shared proxy.
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }],
      },
    ];
  },
};

export default nextConfig;
