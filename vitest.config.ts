import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { checkNodeVersion } from "./scripts/check-node-version.mjs";

// package scripts の pre-hook だけでなく `pnpm exec vitest` の直接実行も、jsdom を
// 初期化する前に同じ engines.node 契約で停止させる(issue #495)。
checkNodeVersion();

/**
 * Test environments are split by file extension so node-based logic tests and
 * jsdom-based React component tests coexist in one project run:
 *
 * - `*.{test,spec}.ts`  → **node** environment (pure game/rule/logic code, no DOM).
 * - `*.{test,spec}.tsx` → **jsdom** environment (React component tests via
 *   Testing Library; `vitest.setup.ts` registers `jest-dom` matchers and auto
 *   `cleanup()`).
 *
 * A single file can override its environment with a `// @vitest-environment …`
 * docblock if it ever needs to opt out of this convention.
 *
 * Run everything with `pnpm test`, or a single environment with
 * `pnpm test:unit` (node) / `pnpm test:component` (jsdom).
 */
/**
 * `@/*` → `src/*`(`tsconfig.json` の paths と対応)。ソースが `@/` エイリアスで参照する
 * ランタイム値を、ページ/コンポーネントを直接読み込むテストでも解決できるようにする。
 */
const srcAlias = { "@": fileURLToPath(new URL("./src", import.meta.url)) };
const jsdomEnvironmentOptions = {
  jsdom: { url: "http://localhost:3000" },
};

export default defineConfig({
  resolve: { alias: srcAlias },
  test: {
    // Coverage is a run-wide concern, so it stays at the root config and
    // aggregates across both projects below.
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
    },
    projects: [
      {
        // `resolve.alias` must be declared per project — a root-level alias does
        // not propagate into `projects` entries.
        resolve: { alias: srcAlias },
        test: {
          name: "unit",
          environment: "node",
          environmentOptions: jsdomEnvironmentOptions,
          globals: true,
          setupFiles: ["./vitest.browser-storage.setup.ts"],
          include: ["src/**/*.{test,spec}.ts"],
          // 3 worktree のローカルゲートを同時に走らせても、重い決定的テストが
          // worker のCPU競合で飢餓状態にならないよう、unit は直列実行する。
          fileParallelism: false,
          maxWorkers: 1,
          // 重い決定的テスト(例: cross-validation の 40k 手オラクル照合、
          // engine.melds-riichi の全公開アクション走破)は、全ファイル並列実行時の
          // CPU 競合で Vitest 既定の 5,000ms を超えることがある(issue #262)。
          // 既定値への暗黙依存を避け、網羅性(反復回数)を維持したまま
          // タイムアウト由来の flaky を防ぐため、unit プロジェクトのみ余裕を持たせる。
          // component(jsdom)側は軽量な UI テストのみなので、ハング検出のため既定値を維持。
          testTimeout: 30_000,
        },
      },
      {
        // The React plugin only applies to the component project so node tests
        // are not needlessly run through the JSX/Babel transform.
        resolve: { alias: srcAlias },
        plugins: [react()],
        test: {
          name: "component",
          environment: "jsdom",
          environmentOptions: jsdomEnvironmentOptions,
          globals: true,
          setupFiles: [
            "./vitest.setup.ts",
            "./vitest.browser-storage.setup.ts",
          ],
          include: ["src/**/*.{test,spec}.tsx"],
          // jsdom の起動コストが大きいUIテストをworktree間で安定して走らせる。
          fileParallelism: false,
          maxWorkers: 1,
        },
      },
    ],
  },
});
