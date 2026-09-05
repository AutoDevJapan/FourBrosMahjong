import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DEPLOYMENT_DOC = readFileSync(
  resolve(process.cwd(), "docs/デプロイ環境運用.md"),
  "utf8",
);

describe("deployment inventory evidence", () => {
  it("keeps the post-#941 main, Vercel deployment, and service-worker evidence aligned", () => {
    expect(DEPLOYMENT_DOC).toContain("#941 merge後、監査対象commit `5bb65d1`");
    expect(DEPLOYMENT_DOC).toContain(
      "`5bb65d1e914b7a100298efb096e6b36f11bf357d`（#941 merge 後）",
    );
    expect(DEPLOYMENT_DOC).toContain("GitHub deployment `6280216047`");
    expect(DEPLOYMENT_DOC).toContain(
      "https://four-bros-mahjong-mkywohfq3.vercel.app",
    );
    expect(DEPLOYMENT_DOC).toContain("VERSION` は `5bb65d1e914b`");
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
