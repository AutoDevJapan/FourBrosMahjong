import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DEPLOYMENT_DOC = readFileSync(
  resolve(process.cwd(), "docs/デプロイ環境運用.md"),
  "utf8",
);

describe("deployment inventory evidence", () => {
  it("keeps the post-#948 main, Vercel deployment, and service-worker evidence aligned", () => {
    expect(DEPLOYMENT_DOC).toContain("#948 merge後、監査対象commit `6e66787`");
    expect(DEPLOYMENT_DOC).toContain(
      "`6e667870afeedf94b9ec57c0e7484ed275b76581`（#948 merge 後）",
    );
    expect(DEPLOYMENT_DOC).toContain("GitHub deployment `6281044309`");
    expect(DEPLOYMENT_DOC).toContain(
      "https://four-bros-mahjong-d495x81yp.vercel.app",
    );
    expect(DEPLOYMENT_DOC).toContain("VERSION` は `6e667870afee`");
    expect(DEPLOYMENT_DOC).toContain(
      "CI `33966542466`、gitleaks `33966542493`、CodeQL `33966542510` がすべて `success`",
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
