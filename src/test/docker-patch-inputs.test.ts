import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Docker workspace dependency patches", () => {
  it("supplies every declared pnpm patch before a frozen workspace install", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    const docker = readFileSync("Dockerfile", "utf8");
    const beforeInstall = docker.slice(
      0,
      docker.indexOf("--fail-if-no-match install"),
    );
    const copies = [...beforeInstall.matchAll(/^COPY\s+(.+)\s+(.+)$/gm)].map(
      (match) => match[1].split(/\s+/),
    );
    const patches = Object.values(pkg.pnpm.patchedDependencies) as string[];
    expect(patches.length).toBeGreaterThan(0);
    for (const patch of patches) {
      expect(readFileSync(patch, "utf8").length).toBeGreaterThan(0);
      expect(
        copies.some(
          (sources) => sources.includes(patch) || sources.includes("patches"),
        ),
        patch,
      ).toBe(true);
    }
  });
});
