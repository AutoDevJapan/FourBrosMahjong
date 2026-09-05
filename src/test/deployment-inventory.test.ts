import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DEPLOYMENT_DOC = readFileSync(
  resolve(process.cwd(), "docs/デプロイ環境運用.md"),
  "utf8",
);

describe("deployment inventory evidence", () => {
  it("keeps the post-#976 main, Vercel deployment, and service-worker evidence aligned", () => {
    expect(DEPLOYMENT_DOC).toContain("#976 merge後、監査対象commit `7ae2a21`");
    expect(DEPLOYMENT_DOC).toContain(
      "`7ae2a2112de034d00d9ff1513808f7ddc54f1863`（#976 merge 後）",
    );
    expect(DEPLOYMENT_DOC).toContain("GitHub deployment `6282910098`");
    expect(DEPLOYMENT_DOC).toContain(
      "https://four-bros-mahjong-pmvjgec84.vercel.app",
    );
    expect(DEPLOYMENT_DOC).toContain("VERSION` は `7ae2a2112de0`");
    expect(DEPLOYMENT_DOC).toContain(
      "CI `33976346362`、gitleaks `33976346351`、CodeQL `33976346415` がすべて `success`",
    );
  });

  it("keeps the unresolved #653 Railway gate explicit", () => {
    expect(DEPLOYMENT_DOC).toContain("`GET /readyz` は `404`（`not_found`）");
    expect(DEPLOYMENT_DOC).toContain("Origin なしは `101`（期待値 `403`）");
    expect(DEPLOYMENT_DOC).toContain(
      "Railway production deployment / config read-back",
    );
    expect(DEPLOYMENT_DOC).toContain("#653 の外部前提");
    expect(DEPLOYMENT_DOC).toContain("**HOLD** とする");
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
