import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DEPLOYMENT_DOC = readFileSync(
  resolve(process.cwd(), "docs/デプロイ環境運用.md"),
  "utf8",
);

describe("deployment inventory evidence", () => {
  it("keeps the post-#908 main, Vercel deployment, and service-worker evidence aligned", () => {
    expect(DEPLOYMENT_DOC).toContain("#908 merge後、監査対象commit `278fdd2`");
    expect(DEPLOYMENT_DOC).toContain(
      "`278fdd28af40a03d906cc948b84668929290da29`（#908 merge 後）",
    );
    expect(DEPLOYMENT_DOC).toContain("GitHub deployment `6277663054`");
    expect(DEPLOYMENT_DOC).toContain(
      "https://four-bros-mahjong-31b5374kd.vercel.app",
    );
    expect(DEPLOYMENT_DOC).toContain("VERSION` は `278fdd28af40`");
  });
});
