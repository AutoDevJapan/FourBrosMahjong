import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DEPLOYMENT_DOC = readFileSync(
  resolve(process.cwd(), "docs/デプロイ環境運用.md"),
  "utf8",
);

describe("deployment inventory evidence", () => {
  it("keeps the post-#944 main, Vercel deployment, and service-worker evidence aligned", () => {
    expect(DEPLOYMENT_DOC).toContain("#944 merge後、監査対象commit `81c0313`");
    expect(DEPLOYMENT_DOC).toContain(
      "`81c0313c15c816b013b3bd77f76480fc5910ebb3`（#944 merge 後）",
    );
    expect(DEPLOYMENT_DOC).toContain("GitHub deployment `6280529940`");
    expect(DEPLOYMENT_DOC).toContain(
      "https://four-bros-mahjong-mvk5ifyvo.vercel.app",
    );
    expect(DEPLOYMENT_DOC).toContain("VERSION` は `81c0313c15c8`");
  });

  it("keeps the six-screen fallback smoke evidence visible", () => {
    expect(DEPLOYMENT_DOC).toContain("合計12/12 pass");
    expect(DEPLOYMENT_DOC).toContain("local Playwright");
    for (const path of [
      "/",
      "/rules",
      "/settings",
      "/history",
      "/game?seed=0",
      "/game/result",
    ]) {
      expect(DEPLOYMENT_DOC).toContain(`\`${path}\``);
    }
  });
});
