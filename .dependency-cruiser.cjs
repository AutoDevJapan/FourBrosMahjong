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
 * - `no-domain-to-presentation` / `no-components-to-app` are `severity: "error"`
 *   for the same exit-code reason as `no-circular`. They encode the layered
 *   dependency direction (presentation → domain, and within presentation
 *   app → components) that issue #12 listed but deferred while `src/` had no
 *   domain layer; `src/domain/` is now implemented, so the deferral condition
 *   is satisfied (issue #382).
 * - `no-server-to-presentation` is `severity: "error"` because the production
 *   online server must be reusable without React or the Next.js App Router.
 *   Shared game/protocol code therefore lives under `src/domain/` or `src/lib/`.
 * - `no-unresolvable-in-src` and `no-unresolvable-in-server` are `severity: "error"`
 *   because they guard the
 *   *precondition* of every path-based rule above. `src/` imports go through
 *   the `@/*` alias, which dependency-cruiser can only follow via
 *   `options.tsConfig`. Drop that option and 47 `src/` imports silently become
 *   unresolvable, at which point the layer rules match nothing and a
 *   domain → UI canary passes with exit 0 (measured). Without these rules that
 *   failure mode is completely silent in either shipped graph.
 */

/**
 * Test files are excluded from the *source* side of the layer rules: the
 * boundary being enforced is the shipped dependency graph, and domain tests
 * legitimately reuse presentation-side fixtures/view-model mappers to drive
 * integration-style scenarios (e.g. `components/game/finishedGameFixture.ts`,
 * which documents itself as test-only). Production modules get no such waiver.
 */
const TEST_FILE = "\\.(test|spec)\\.tsx?$";

/** Domain layer: pure game logic, must not know about any UI. */
const DOMAIN = "^src/domain/";
/** Presentation layer: React components plus the Next.js App Router tree. */
const PRESENTATION = "^src/(app|components)/";
/** App Router tree only (routing/page shell), the outermost presentation ring. */
const APP_ROUTER = "^src/app/";
/** Shared React components, inner to the App Router tree. */
const COMPONENTS = "^src/components/";
/** Everything the layer rules govern. */
const SRC = "^src/";
/** Production online server; test modules are exempt only from presentation boundaries. */
const SERVER = "^server/";

/** @type {import('dependency-cruiser').IConfiguration} */
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
    {
      name: "no-domain-to-presentation",
      comment:
        "Domain (src/domain) must not depend on presentation (src/app, src/components). " +
        "Dependencies point inward only; a domain module that imports UI cannot be " +
        "reasoned about, tested, or reused without the React/Next runtime.",
      severity: "error",
      from: { path: DOMAIN, pathNot: TEST_FILE },
      to: { path: PRESENTATION },
    },
    {
      name: "no-components-to-app",
      comment:
        "Shared components (src/components) must not depend on the App Router tree " +
        "(src/app). Route files compose components, never the reverse; the inverse " +
        "edge couples reusable UI to a specific route's shell.",
      severity: "error",
      from: { path: COMPONENTS, pathNot: TEST_FILE },
      to: { path: APP_ROUTER },
    },
    {
      name: "no-server-to-presentation",
      comment:
        "Production server modules must not depend on React/App Router presentation modules. " +
        "Shared game/protocol code belongs under src/domain or src/lib.",
      severity: "error",
      from: { path: SERVER, pathNot: TEST_FILE },
      to: { path: PRESENTATION },
    },
    {
      name: "no-runtime-to-css-excluded-inputs",
      comment:
        "CSS source exclusions assume these native/evidence/asset-audit inputs " +
        "do not supply runtime classes. Review globals.css before importing them " +
        "into shipped code; the production Unity contract fixture is not excluded.",
      severity: "error",
      // Apply to intermediate modules too, so a runtime re-export through scripts/
      // cannot bypass the boundary. Test consumers remain legitimate.
      from: {
        pathNot: [
          TEST_FILE,
          "^(src/test|e2e)/",
          "(^|/)(__testing__|__oracle__)/",
        ],
      },
      to: {
        // Erased type contracts do not supply classes; direction rules still apply.
        dependencyTypesNot: ["type-only"],
        path: "^(\\.godd/|prototypes/|documents/(evidence/|assets/|fixtures/railway-(pre-cutover|readyz-before-iac)\\.json$))|(^|/)(__testing__|__oracle__)/",
      },
    },
    {
      name: "no-unresolvable-in-src",
      comment:
        "An import under src/ that dependency-cruiser cannot resolve produces no " +
        "dependency edge, so every path-based rule above stops matching it. Scoped " +
        "to src/ because root-level tooling configs legitimately reference modules " +
        "outside the cruised graph.",
      severity: "error",
      from: { path: SRC },
      to: { couldNotResolve: true },
    },
    {
      name: "no-unresolvable-in-server",
      comment:
        "An unresolvable server import must fail the architecture gate instead of " +
        "silently disappearing from the production dependency graph.",
      severity: "error",
      from: { path: SERVER },
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsConfig: { fileName: "tsconfig.json" },
    tsPreCompilationDeps: true,
    // Resolve exports-only SDK and CSS compiler packages using the official
    // resolver defaults, without waiving no-unresolvable-in-src.
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
  },
};
