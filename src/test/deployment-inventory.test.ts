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
    expect(DEPLOYMENT_DOC).toContain("#1149 merge後、監査対象commit `5d224c1`");
    expect(DEPLOYMENT_DOC).toContain(
      "`5d224c10564537433b23b94173f677eb453b40ad`（#1149 merge 後）",
    );
    expect(DEPLOYMENT_DOC).toContain("GitHub deployment `6298287889`");
    expect(DEPLOYMENT_DOC).toContain(
      "https://four-bros-mahjong-3qhkztdy1.vercel.app",
    );
    expect(DEPLOYMENT_DOC).toContain("VERSION` は `5d224c105645`");
    expect(DEPLOYMENT_DOC).toContain(
      "CI `34061532330`、gitleaks `34061532291`、CodeQL `34061532128` がすべて `success`",
    );
  });

  it("keeps the #725 current-head evidence aligned with the same deployment", () => {
    expect(TOPOLOGY_EVIDENCE_DOC).toContain(
      "`5d224c10564537433b23b94173f677eb453b40ad`（#1149 merge 後",
    );
    expect(TOPOLOGY_EVIDENCE_DOC).toContain("deployment `6298287889`");
    expect(TOPOLOGY_EVIDENCE_DOC).toContain(
      "https://four-bros-mahjong-3qhkztdy1.vercel.app",
    );
    expect(TOPOLOGY_EVIDENCE_DOC).toContain('VERSION = "5d224c105645"');
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
