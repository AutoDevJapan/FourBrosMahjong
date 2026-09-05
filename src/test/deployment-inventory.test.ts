import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DEPLOYMENT_DOC = readFileSync(
  resolve(process.cwd(), "docs/デプロイ環境運用.md"),
  "utf8",
);

describe("deployment inventory evidence", () => {
  it("keeps the post-#959 main, Vercel deployment, and service-worker evidence aligned", () => {
    expect(DEPLOYMENT_DOC).toContain("#959 merge後、監査対象commit `98cb3de`");
    expect(DEPLOYMENT_DOC).toContain(
      "`98cb3de8b6e41dc27b1352d8708596f2d842fc02`（#959 merge 後）",
    );
    expect(DEPLOYMENT_DOC).toContain("GitHub deployment `6282070040`");
    expect(DEPLOYMENT_DOC).toContain(
      "https://four-bros-mahjong-avyd2ye8o.vercel.app",
    );
    expect(DEPLOYMENT_DOC).toContain("VERSION` は `98cb3de8b6e4`");
    expect(DEPLOYMENT_DOC).toContain(
      "CI `33971927142`、gitleaks `33971927047`、CodeQL `33971926519` がすべて `success`",
    );
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
