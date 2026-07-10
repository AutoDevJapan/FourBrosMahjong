import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node environment suits pure game/logic code. Switch to "jsdom"
    // (and install jsdom + @testing-library/react) for component tests.
    environment: "node",
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
    },
  },
});
