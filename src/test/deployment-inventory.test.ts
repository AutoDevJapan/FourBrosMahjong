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
      "#1035 merge後、監査対象commit `aae1083b`",
    );
    expect(DEPLOYMENT_DOC).toContain(
      "`aae1083be80e330941d6d72867a591a9fd48881f`（#1035 merge 後）",
    );
    expect(DEPLOYMENT_DOC).toContain("GitHub deployment `6288917306`");
    expect(DEPLOYMENT_DOC).toContain(
      "https://four-bros-mahjong-2wwu78o6g.vercel.app",
    );
    expect(DEPLOYMENT_DOC).toContain("VERSION` は `aae1083be80e`");
    expect(DEPLOYMENT_DOC).toContain(
      "CI `34010359025`、gitleaks `34010359024`、CodeQL `34010358641` がすべて `success`",
    );
  });

  it("keeps the #725 current-head evidence aligned with the same deployment", () => {
    expect(TOPOLOGY_EVIDENCE_DOC).toContain(
      "`aae1083be80e330941d6d72867a591a9fd48881f`（#1035 merge 後",
    );
    expect(TOPOLOGY_EVIDENCE_DOC).toContain("deployment `6288917306`");
    expect(TOPOLOGY_EVIDENCE_DOC).toContain(
      "https://four-bros-mahjong-2wwu78o6g.vercel.app",
    );
    expect(TOPOLOGY_EVIDENCE_DOC).toContain('VERSION = "aae1083be80e"');
    expect(TOPOLOGY_EVIDENCE_DOC).toContain("6 route × 3 viewport");
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
    expect(DEPLOYMENT_DOC).toContain("合計18/18 pass");
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
