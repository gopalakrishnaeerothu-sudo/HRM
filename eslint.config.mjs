import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

/**
 * ESLint flat config.
 *
 * Lint runs as its own step (`npm run lint`) rather than inside `next build`,
 * so a style nit never blocks a deploy that type-checks and builds. Type errors
 * still do block it — those are correctness.
 */
export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
    ],
  },
  {
    rules: {
      // Unused args prefixed with _ are intentional (destructuring rest, etc.).
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // `any` is banned outright — the codebase has none, and this keeps it so.
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // The seed is a script: console output is the point.
    files: ["prisma/**/*.ts", "tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
];
