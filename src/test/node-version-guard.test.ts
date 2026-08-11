import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  nodeVersionError,
  requiredNodeRange,
} from "../../scripts/check-node-version.mjs";

const VITEST_SCRIPTS = [
  "test",
  "test:unit",
  "test:component",
  "test:watch",
  "test:coverage",
] as const;

function packageJson(): {
  engines?: { node?: string };
  scripts?: Record<string, string>;
} {
  const source = readFileSync(resolve(process.cwd(), "package.json"), "utf8");
  return JSON.parse(source);
}

describe("Node.js version guard (#495)", () => {
  it("uses package.json engines.node as the single source of truth", () => {
    expect(requiredNodeRange()).toBe(packageJson().engines?.node);
    expect(nodeVersionError(process.versions.node)).toBeNull();
  });

  it("explains the installed and required versions for unsupported Node.js", () => {
    const message = nodeVersionError("25.9.0");
    expect(message).toContain("v25.9.0");
    expect(message).toContain(requiredNodeRange());
    expect(message).toContain("nvm use");
  });

  it("runs the guard before every Vitest script", () => {
    const scripts = packageJson().scripts ?? {};
    for (const name of VITEST_SCRIPTS) {
      expect(scripts[`pre${name}`], `${name} is not guarded`).toBe(
        "node scripts/check-node-version.mjs",
      );
    }
  });
});
