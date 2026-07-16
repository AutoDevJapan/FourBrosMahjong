import { describe, expect, it } from "vitest";

/**
 * Companion to `component-smoke.test.tsx`: this `.ts` spec runs in the node
 * project, proving node and jsdom tests coexist in one run and are routed by
 * file extension (see vitest.config.ts).
 */
describe("test environment split", () => {
  it("runs .ts specs in the node environment (no DOM globals)", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
  });
});
