# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

Freshly bootstrapped `create-next-app` scaffold — the app itself has not been built yet. `src/app/` still holds the default template (`page.tsx`, `layout.tsx`); no game logic exists yet.

**What this project is:** a digital version of **四兄弟麻雀 (Four Brothers Mahjong)** — the mahjong segment from 粗品 Official Channel's「ギャンブル四兄弟」. It is a Kansai-style three-player (サンマ) variant with distinctive rules (all-red 5s, 北 pull-dora "ガリ", dice-driven dora count, four-player rotation, "ソシー" scoring). See the rule SSOT below before implementing any game logic.

## Game rules (SSOT)

- `docs/四兄弟麻雀ルール.md` — the single source of truth for game rules (real-world show summary). Read it before touching any game/scoring/tile logic.
- `docs/README.md` — documentation navigation hub.
- `documents/spec/` — **implementation spec (SpecDD SSOT)**: confirmed rules decomposed into I/O, states, boundary values, and completion criteria (setup/tiles, game-flow with a Mermaid state diagram, scoring/settlement, domain-model with a class diagram). Implement against this. `documents/` is the GoDD `docs_dir`.
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

- **Vitest** (`vitest.config.ts`): `node` environment (suits pure game/logic code); tests live next to source as `*.test.ts`/`*.spec.ts` under `src/`. For React component tests, switch the environment to `jsdom` and add `jsdom` + `@testing-library/react`.
- **Playwright** (`playwright.config.ts`): specs in `./e2e`; the config auto-starts `pnpm dev`. First run needs browsers: `pnpm exec playwright install`.
- **Biome** (`biome.json`): formatter + assist only — **linter is disabled** to avoid overlap with ESLint (`next lint`). CSS parser has `tailwindDirectives` enabled for the `@theme` block in `globals.css`.
- **Knip** (`knip.json`): `eslint` / `eslint-config-next` are in `ignoreDependencies` (used via flat-config `compat.extends`, which knip can't trace).
- **dependency-cruiser** (`.dependency-cruiser.cjs`): warns on circular deps and orphan modules.
- **TypeDoc** (`typedoc.json`): expands over `src`, outputs to `docs/api` (gitignored).

## Stack & conventions

- **Next.js 15** (App Router) with **React 19** and **TypeScript** (`strict` mode).
- **Tailwind CSS v4** — configured via `@import "tailwindcss"` and the `@theme` block in `src/app/globals.css`; there is no `tailwind.config.*` file. PostCSS uses `@tailwindcss/postcss` (`postcss.config.mjs`).
- Import alias: `@/*` → `./src/*` (see `tsconfig.json`).
- Dev/build use Turbopack; `next.config.ts` is currently empty.
- Routing lives in `src/app/` (App Router). Add routes as folders with `page.tsx`; shared shell is `layout.tsx`.
