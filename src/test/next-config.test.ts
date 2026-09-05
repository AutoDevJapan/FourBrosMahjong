import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

describe("Next.js local configuration", () => {
  it("does not let dev startup mutate the shared agent instructions", () => {
    expect(nextConfig.agentRules).toBe(false);
  });
});
