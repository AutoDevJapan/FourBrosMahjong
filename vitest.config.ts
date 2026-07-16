import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

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
export default defineConfig({
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
        test: {
          name: "unit",
          environment: "node",
          globals: true,
          include: ["src/**/*.{test,spec}.ts"],
        },
      },
      {
        // The React plugin only applies to the component project so node tests
        // are not needlessly run through the JSX/Babel transform.
        plugins: [react()],
        test: {
          name: "component",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./vitest.setup.ts"],
          include: ["src/**/*.{test,spec}.tsx"],
        },
      },
    ],
  },
});
