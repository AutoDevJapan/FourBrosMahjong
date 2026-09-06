import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DEPLOYMENT_DOC = readFileSync(
  resolve(process.cwd(), "docs/デプロイ環境運用.md"),
  "utf8",
);
const TOPOLOGY_EVIDENCE_DOC = readFileSync(
  resolve(
    process.cwd(),
    "docs/ops/2026-09-06-725-environment-topology-evidence.md",
  ),
  "utf8",
);

describe("deployment inventory evidence", () => {
  it("keeps the current main, Vercel deployment, and service-worker evidence aligned", () => {
    expect(DEPLOYMENT_DOC).toContain(
      "#1133 merge後、監査対象commit `df56930b`",
    );
    expect(DEPLOYMENT_DOC).toContain(
      "`df56930b360c0995e44319470707b08e4505106c`（#1133 merge 後）",
    );
    expect(DEPLOYMENT_DOC).toContain("GitHub deployment `6296644111`");
    expect(DEPLOYMENT_DOC).toContain(
      "https://four-bros-mahjong-8mmsfwjpb.vercel.app",
    );
    expect(DEPLOYMENT_DOC).toContain("VERSION` は `df56930b360c`");
    expect(DEPLOYMENT_DOC).toContain(
      "CI `34052792031`、gitleaks `34052792022`、CodeQL `34052791856` がすべて `success`",
    );
  });

  it("keeps the #725 current-head evidence aligned with the same deployment", () => {
    expect(TOPOLOGY_EVIDENCE_DOC).toContain(
      "`df56930b360c0995e44319470707b08e4505106c`（#1133 merge 後",
    );
    expect(TOPOLOGY_EVIDENCE_DOC).toContain("deployment `6296644111`");
    expect(TOPOLOGY_EVIDENCE_DOC).toContain(
      "https://four-bros-mahjong-8mmsfwjpb.vercel.app",
    );
    expect(TOPOLOGY_EVIDENCE_DOC).toContain('VERSION = "df56930b360c"');
    expect(TOPOLOGY_EVIDENCE_DOC).toContain("6 route");
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
    expect(DEPLOYMENT_DOC).toContain("合計6/6 status 200");
    expect(DEPLOYMENT_DOC).toContain("curlでread-only HTTP確認");
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
