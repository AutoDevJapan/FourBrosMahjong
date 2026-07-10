/**
 * Dependency direction policy (see docs/品質ツール運用方針.md for full rationale).
 *
 * - `no-circular` is `severity: "error"`: dependency-cruiser's CLI exit code is
 *   the *error*-severity violation count only (`warn`/`info` never fail the
 *   process — see `report/error.mjs`'s `exitCode: pResults.summary.error`), so
 *   this is the minimum severity for the rule to actually be enforced by
 *   `pnpm depcruise` (which CI runs unconditionally). Circular deps are banned
 *   outright per issue #12's acceptance criteria.
 * - `no-orphans` stays `severity: "warn"` (advisory, not enforced): it is a
 *   dead-code *hint*, not an architectural boundary, and Next.js App Router
 *   entry files (`page.tsx`, `layout.tsx`, `route.ts`, …) are reached via
 *   file-system routing rather than a static `import`, so a stricter severity
 *   would produce framework-driven false positives. This is safe from false
 *   positives today because the rule requires a module to have **both** zero
 *   incoming *and* zero outgoing edges (`from: { orphan: true }`, `to: {}`);
 *   route files always import at least React/Next APIs, so they never match.
 * - A layered "UI → domain, one direction only" rule (the other example in
 *   issue #12) is deferred until `src/` actually has more than one layer
 *   (currently only `src/app/` exists per CLAUDE.md's "Project state") —
 *   encoding a path-based rule against folders that don't exist yet would be
 *   untestable dead config. Add it under a `no-ui-importing-domain-internals`
 *   (or similar) rule name once `documents/spec/domain-model.md` is
 *   implemented as code.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment: "Circular dependencies make code hard to reason about.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      comment: "Modules that nothing imports and that import nothing.",
      severity: "warn",
      from: {
        orphan: true,
        pathNot: ["\\.d\\.ts$", "(^|/)\\.[^/]+\\.(js|cjs|mjs|ts)$"],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
  },
};
