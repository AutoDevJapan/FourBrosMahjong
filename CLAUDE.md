# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

Freshly bootstrapped `create-next-app` scaffold — the app itself has not been built yet. `src/app/` still holds the default template (`page.tsx`, `layout.tsx`); no game logic exists yet.

**What this project is:** a digital version of **四兄弟麻雀 (Four Brothers Mahjong)** — the mahjong segment from 粗品 Official Channel's「ギャンブル四兄弟」. It is a Kansai-style three-player (サンマ) variant with distinctive rules (all-red 5s, 北 pull-dora "ガリ", dice-driven dora count, four-player rotation, "ソシー" scoring). See the rule SSOT below before implementing any game logic.

## Game rules (SSOT)

- `docs/四兄弟麻雀ルール.md` — the single source of truth for game rules (real-world show summary). Read it before touching any game/scoring/tile logic.
- `docs/README.md` — documentation navigation hub.
- `documents/spec/` — **implementation spec (SpecDD SSOT)**: confirmed rules decomposed into I/O, states, boundary values, and completion criteria (setup/tiles, game-flow with a Mermaid state diagram, scoring/settlement, domain-model with a class diagram). Implement against this. `documents/` is the GoDD `docs_dir`.
- `documents/spec/ui-accessibility-responsive-darkmode.md` — cross-cutting UI policy for accessibility, responsive breakpoints, and dark mode (color-independent info, keyboard/focus, breakpoints, dark mode toggle decision, color tokens, a11y verification tooling). Any future UI implementation (issues #8, #9, etc.) must follow this policy.
- `質問リスト.md` (repo root) — open spec questions. Q1–Q8 resolved (see 解決済み). **Q9–Q13 remain open** (bench rotation order, seat/dealer assignment, 東南戦 progression, tsumo payment split, uma allocation) — do **not** implement the affected areas (seating, dealer, tsumo scoring, uma) until answered; never guess.

Config note: `config.godd` sets `display_language: ja` (respond in Japanese) and `docs_dir: documents` (GoDD spec SSOT goes under `documents/` once such content exists — kept separate from the human-facing `docs/`).

## Package manager

This project uses **pnpm** (pinned via `packageManager` in `package.json`). Do **not** use npm or yarn — there is no `package-lock.json`, only `pnpm-lock.yaml`. Install with `pnpm install`.

## Commands

```bash
pnpm dev            # dev server with Turbopack at http://localhost:3000
pnpm build          # production build
pnpm start          # serve the production build
pnpm lint           # ESLint (next/core-web-vitals + next/typescript)
pnpm typecheck      # tsc --noEmit

pnpm test           # Vitest (unit) — src/**/*.{test,spec}.{ts,tsx}
pnpm test:watch     # Vitest watch mode
pnpm test:coverage  # Vitest with v8 coverage
pnpm test:e2e       # Playwright E2E — specs in ./e2e (auto-starts dev server)

pnpm format         # Biome: format & write
pnpm format:check   # Biome: check formatting only
pnpm check          # Biome: check (format + assist)
pnpm knip           # find unused files/exports/deps
pnpm depcruise      # dependency-cruiser rules over src
pnpm docs           # TypeDoc → docs/api (gitignored)
```

Run a single Vitest file: `pnpm exec vitest run src/foo.test.ts` (or `-t "name"` for one test).

## Tooling layout

- **Vitest** (`vitest.config.ts`): two projects split by file extension so node logic tests and jsdom component tests run together. `*.{test,spec}.ts` → **node** environment (pure game/logic code); `*.{test,spec}.tsx` → **jsdom** environment for React component tests (`@testing-library/react` + `@testing-library/user-event`, with `vitest.setup.ts` registering `@testing-library/jest-dom` matchers and per-test `cleanup()`). Tests live next to source under `src/`. `pnpm test` runs both; `pnpm test:unit` / `pnpm test:component` run one project. A single file can override its environment with a `// @vitest-environment …` docblock.
- **Playwright** (`playwright.config.ts`): specs in `./e2e`; the config auto-starts `pnpm dev`. First run needs browsers: `pnpm exec playwright install`.
- **Biome** (`biome.json`): formatter + assist only — **linter is disabled** to avoid overlap with ESLint (`eslint .`, config in `eslint.config.mjs`). CSS parser has `tailwindDirectives` enabled for the `@theme` block in `globals.css`. `files.includes` explicitly excludes build/test/doc-generation output (`.next/`, `out/`, `coverage/`, `playwright-report/`, `test-results/`, `docs/api/`), mirroring `eslint.config.mjs`'s `ignores`.
- **Knip** (`knip.json`): deliberately minimal (`$schema` only) — Next.js's App Router entry files (`page.tsx`/`layout.tsx`/`route.ts`/etc.) are auto-detected by knip's built-in Next.js plugin, and knip already respects `.gitignore` for generated output, so explicit `entry`/`ignore` config would be redundant (knip's own config-hint diagnostics flag exactly that if added).
- **dependency-cruiser** (`.dependency-cruiser.cjs`): `no-circular` is `severity: "error"` (enforced — dependency-cruiser's CLI exit code only reflects `error`-severity violations, so `warn` would never fail CI); `no-orphans` stays `severity: "warn"` (advisory dead-code hint, not an architectural boundary).
- **TypeDoc** (`typedoc.json`): expands over `src`, outputs to `docs/api` (gitignored, not a CI gate); `excludePrivate`/`excludeInternal`/`excludeExternals` keep the generated docs scoped to the public API surface.

Full rationale, exclusion justifications, and the local/pre-commit/CI execution-timing matrix for all four tools: [`docs/品質ツール運用方針.md`](docs/品質ツール運用方針.md).

## Stack & conventions

- **Next.js 16** (App Router) with **React 19** and **TypeScript** (`strict` mode).
- **Tailwind CSS v4** — configured via `@import "tailwindcss"` and the `@theme` block in `src/app/globals.css`; there is no `tailwind.config.*` file. PostCSS uses `@tailwindcss/postcss` (`postcss.config.mjs`).
- Import alias: `@/*` → `./src/*` (see `tsconfig.json`).
- Dev/build use Turbopack; `next.config.ts` is currently empty.
- Routing lives in `src/app/` (App Router). Add routes as folders with `page.tsx`; shared shell is `layout.tsx`.
