/**
 * No-op stand-in for the `server-only` package under Vitest.
 *
 * The real module throws on import to stop server code leaking into a client
 * bundle. That check is a *build-time* guarantee enforced by Next; under
 * Vitest there is no client bundle, so importing the real one would fail every
 * test that touches a repository or service.
 *
 * Aliased in vitest.config.ts. Nothing imports this directly.
 */
export {};
