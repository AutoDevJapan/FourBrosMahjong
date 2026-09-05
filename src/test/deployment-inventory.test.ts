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
      "#1025 merge後、監査対象commit `f3130316`",
    );
    expect(DEPLOYMENT_DOC).toContain(
      "`f3130316ea81f56fc46d302fe572a658d44abce7`（#1025 merge 後）",
    );
    expect(DEPLOYMENT_DOC).toContain("GitHub deployment `6286927273`");
    expect(DEPLOYMENT_DOC).toContain(
      "https://four-bros-mahjong-8vjmtdf19.vercel.app",
    );
    expect(DEPLOYMENT_DOC).toContain("VERSION` は `f3130316ea81`");
    expect(DEPLOYMENT_DOC).toContain(
      "CI `33998271577`、gitleaks `33998271575`、CodeQL `33998271380` がすべて `success`",
    );
  });

  it("keeps the #725 current-head evidence aligned with the same deployment", () => {
    expect(TOPOLOGY_EVIDENCE_DOC).toContain(
      "`f3130316ea81f56fc46d302fe572a658d44abce7`（#1025 merge 後",
    );
    expect(TOPOLOGY_EVIDENCE_DOC).toContain("deployment `6286927273`");
    expect(TOPOLOGY_EVIDENCE_DOC).toContain(
      "https://four-bros-mahjong-8vjmtdf19.vercel.app",
    );
    expect(TOPOLOGY_EVIDENCE_DOC).toContain('VERSION = "f3130316ea81"');
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
