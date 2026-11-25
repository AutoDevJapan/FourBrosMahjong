# CLAUDE.md

This is the development guide for 四兄弟麻雀 (Four Brothers Mahjong).

## Deployment policy

@documents/adr/0006-prd-only-deployment.md

See the [deployment guide](docs/デプロイ環境運用.md) for operating procedures and verification records.

## Project state

Under active development. The **domain layer** (`src/domain/`) implements the game logic — tiles, wall/dead-wall, deal, dora (dice-driven count + indicators + han), hand-win detection, seat/round progression, and scoring/settlement — each with co-located Vitest tests plus cross-module integration tests (`src/domain/integration/`). The **App Router UI** (`src/app/`) ships the top page (`/`), online lobby (`/online`), rules (`/rules`), settings (`/settings`, with a dark-mode `ThemeToggle`), the game screen (`/game`), the result screen (`/game/result`), and the match history screen (`/history`, issue #293), with game/UI components under `src/components/`. `/game` is wired to the real game engine (issue #67), and its validated action journal is restored from same-tab `sessionStorage` after reload (issue #190). Offline support ships as a PWA via a Service Worker (`src/app/sw.js`) and web app manifest (`src/app/manifest.ts`, issue #292); `e2e/pwa-offline.spec.ts` covers it against a production build only. Vitest covers domain and component behavior, while Playwright covers browser flows including game interaction, game completion, and persistence. Railway's WebSocket server synchronizes online rooms. Room state is held in memory and is lost when the server restarts.

**What this project is:** a digital version of **四兄弟麻雀 (Four Brothers Mahjong)** — the mahjong segment from 粗品 Official Channel's「ギャンブル四兄弟」. It is a Kansai-style three-player (サンマ) variant with distinctive rules (all-red 5s, 北 pull-dora "ガリ", dice-driven dora count, four-player rotation, "ソシー" scoring). See the rule SSOT below before implementing any game logic.

## Game rules (SSOT)

- `docs/四兄弟麻雀ルール.md` — the single source of truth for game rules (real-world show summary). Read it before touching any game/scoring/tile logic.
- `docs/README.md` — documentation navigation hub.
- `documents/spec/` — **implementation spec (SpecDD SSOT)**: confirmed rules decomposed into I/O, states, boundary values, and completion criteria (setup/tiles, game-flow with a Mermaid state diagram, scoring/settlement, domain-model with a class diagram). Implement against this. `documents/` is the GoDD `docs_dir`.
- `documents/spec/ui-accessibility-responsive-darkmode.md` — cross-cutting UI policy for accessibility, responsive breakpoints, and dark mode (color-independent info, keyboard/focus, breakpoints, dark mode toggle decision, color tokens, a11y verification tooling). All UI implementation must follow this policy.
- `documents/adr/0002-ai-policy.md` — **AI (opponent) policy SSOT** for discard/meld/riichi/kan, with the rationale behind each decision and the quantitative results backing it. AI policy is *not* a game rule (it picks among legal moves), so it lives in `documents/adr/`, not `documents/spec/`. **Any PR that changes AI behavior must update this ADR in the same PR.**
- `質問リスト.md` (repo root) — spec questions log and the **single place that tracks question status** (do not restate counts elsewhere). Resolved answers are reflected in `documents/spec/`; **open unresolved questions may exist** — the current list and status are maintained only in the `未回答 / 要確認` section, so check it before implementing affected areas. Any new design ambiguity is logged there as a new Q entry before implementation — never guess.

`config.godd` defines GoDD's stack metadata, `display_language: ja` (respond in Japanese), and `docs_dir: documents` (implementation specs under `documents/`, with human-facing documentation under `docs/`).

## Package manager

This project uses **pnpm** (pinned via `packageManager` in `package.json`). Do **not** use npm or yarn — there is no `package-lock.json`, only `pnpm-lock.yaml`. Install with `pnpm install`.

## Commands

Use `package.json` for the runnable commands and `.github/workflows/ci.yml` for the current CI steps.

```bash
pnpm dev            # dev server with Turbopack at http://localhost:3000
pnpm build          # production build
pnpm start          # serve the production build
pnpm lint           # ESLint (next/core-web-vitals + next/typescript)
pnpm typecheck      # tsc --noEmit

pnpm test           # Vitest: unit (src/, server/) and component (src/)
pnpm test:watch     # Vitest watch mode
pnpm test:coverage  # Vitest with v8 coverage
pnpm test:e2e       # Playwright E2E — specs in ./e2e (auto-starts dev server)

pnpm format         # Biome: format & write
pnpm check          # Biome: format + assist check (the CI gate)
pnpm format:check   # Biome: formatting only (subset of `check`)
pnpm knip           # find unused files/exports/deps
pnpm depcruise      # dependency-cruiser rules over src and server
pnpm docs           # TypeDoc → docs/api (gitignored)
```

Run a single Vitest file: `pnpm exec vitest run src/foo.test.ts` (or `-t "name"` for one test).

## Tooling layout

- **Vitest** (`vitest.config.ts`): two projects split by file extension so node logic tests and jsdom component tests run together. `*.{test,spec}.ts` → **node** environment (domain and server tests); `*.{test,spec}.tsx` → **jsdom** environment for React component tests (`@testing-library/react` + `@testing-library/user-event`, with `vitest.setup.ts` registering `@testing-library/jest-dom` matchers and per-test `cleanup()`). Unit tests live under `src/` and `server/`, and component tests live under `src/`. `pnpm test` runs both; `pnpm test:unit` / `pnpm test:component` run one project. A single file can override its environment with a `// @vitest-environment …` docblock. The `@/*` → `src/*` alias is registered per project in `vitest.config.ts` (a root-level `resolve.alias` does not propagate into `projects`), so tests can import source modules that use the `@/` alias for runtime values. Timeout policy: the **unit** project sets an explicit `testTimeout: 30_000` because heavy deterministic tests (e.g. the 40k-hand oracle cross-validation) can exceed Vitest's 5s default under full-suite parallel CPU contention (issue #262); the **component** project keeps the 5s default so UI-test hangs surface quickly — don't reintroduce implicit reliance on the default for heavy node tests. Zero-collection policy: the vitest scripts must **not** pass `--passWithNoTests` (issue #381) — it makes a run that collects no tests at all exit 0, so a broken `include` glob or a moved directory would silently disable the whole gate. Note that dropping the flag only catches a run where *every* project collects zero (measured: breaking just the `component` include still exits 0 because `unit` passes), so `src/test/vitest-collection.test.ts` additionally asserts per-project that each `include` matches real files and that `--project` names in `package.json` exist in `vitest.config.ts`.
- **Playwright** (`playwright.config.ts`): specs in `./e2e`; the config auto-starts `pnpm dev`. For a first local run, install Chromium and WebKit with `pnpm exec playwright install chromium webkit`. Two projects: `chromium` runs every spec, and `webkit-modal-focus` re-runs only `e2e/modal-focus.spec.ts` under Desktop Safari — WebKit does not focus a `button` on pointer activation, so modal focus restoration (#369) needs a Safari-equivalent guard without duplicating the whole suite. The `e2e` CI job verifies Chromium and WebKit supplied by its digest-pinned Playwright image. When the `ci` job's browser steps are enabled, it restores the Chromium cache, installs Chromium for production verification or on a cache miss, and saves the cache on `main` after a miss. For production E2E it runs the seven specs in `pnpm test:e2e:prod:prebuilt` with Chromium against the existing `.next` build. A project's `testMatch` silently matching zero specs would drop the WebKit guard without failing CI, so `src/test/playwright-projects.test.ts` pins it to a real spec file.
- **Biome** (`biome.json`): formatter + assist only — **linter is disabled** to avoid overlap with ESLint (`eslint .`, config in `eslint.config.mjs`). CSS parser has `tailwindDirectives` enabled for the `@theme` block in `globals.css`. `files.includes` explicitly excludes build/test/doc-generation output (`.next/`, `out/`, `coverage/`, `playwright-report/`, `test-results/`, `docs/api/`), mirroring `eslint.config.mjs`'s `ignores`.
- **Knip** (`knip.json`): Next.js App Router entries (`page.tsx`/`layout.tsx`/`route.ts`/etc.) are auto-detected. See the checked-in config for repository-specific exclusions.
- **dependency-cruiser** (`.dependency-cruiser.cjs`): `no-circular` is `severity: "error"` (enforced — dependency-cruiser's CLI exit code only reflects `error`-severity violations, so `warn` would never fail CI); `no-orphans` stays `severity: "warn"` (advisory dead-code hint, not an architectural boundary). Layer direction is enforced by `no-domain-to-presentation` (`src/domain/**` must not import `src/app/**` or `src/components/**`) and `no-components-to-app`, both `severity: "error"`, with `*.{test,spec}.{ts,tsx}` excluded from the *source* side (the boundary is about the shipped graph; domain tests may reuse UI-side fixtures). `no-unresolvable-in-src` (also `error`) guards their precondition: `src/` imports use the `@/*` alias, so dropping `options.tsConfig` would make them unresolvable and silently disable every path-based rule. `pnpm depcruise` only asserts "no violations exist today", so `src/test/dependency-layers.test.ts` separately fixes the rules — plus their preconditions and their CI scope — by running dependency-cruiser's own `cruise()` over a synthetic layer fixture in a temp dir with the repo's real `forbidden` rules.
- **TypeDoc** (`typedoc.json`): expands over `src`. Local `pnpm docs` generates `docs/api` (gitignored). In CI, the `ci` job runs `pnpm run docs --emit none` when its production verification scope is selected, checking conversion without writing docs. `excludePrivate`/`excludeInternal`/`excludeExternals` keep the generated docs scoped to the public API surface.

For the rationale behind the tooling and exclusions, see [`docs/品質ツール運用方針.md`](docs/品質ツール運用方針.md).

## Stack & conventions

- **Next.js 16** (App Router) with **React 19** and **TypeScript** (`strict` mode).
- **Tailwind CSS v4** — configured via `@import "tailwindcss"` and the `@theme` block in `src/app/globals.css`; there is no `tailwind.config.*` file. PostCSS uses `@tailwindcss/postcss` (`postcss.config.mjs`).
- Import alias: `@/*` → `./src/*` (see `tsconfig.json`).
- Dev/build use Turbopack; `next.config.ts` defines static security headers and a restrictive CSP for SVG responses.
- Routing lives in `src/app/` (App Router). Add routes as folders with `page.tsx`; shared shell is `layout.tsx`.
