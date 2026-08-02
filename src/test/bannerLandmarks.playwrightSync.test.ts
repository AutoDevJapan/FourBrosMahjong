import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { BANNER_SUPPRESSING_ANCESTORS, VALID_ROLES } from "./bannerLandmarks";

/**
 * `bannerLandmarks()` が `playwright-core` から写した 2 つの定数の**同期を機械で守る**(#431)。
 *
 * spec 5.2.6 の主ゲート(jsdom)と裏取り役の E2E(`getByRole("banner")`)は、同じ規則で
 * banner を判定していないと**片方だけ緑になる**。ところが両者を結んでいるのは
 * `bannerLandmarks.ts` の「一字一句写している」という**散文だけ**で、`pnpm up playwright` を
 * 打った瞬間に無音でずれる。本リポジトリの `src/app` は `<header>` に `role` を付けないので、
 * ずれても既存テストは 1 つも赤くならない。
 *
 * 同型の穴埋めとして `src/app/tailwind-content-scan.regression.test.ts`(除外行の消失)と
 * `src/test/playwright-projects.test.ts`(testMatch の空振り)がある。
 *
 * 検査は `playwright-core` のバンドルから定数の**字面**を取り出して突き合わせる。バンドルの
 * 書き方が変わればここが落ちるが、それは「Playwright 側の実装を読み直せ」という正しい合図
 * (黙って古い規則を使い続けるより良い)。失敗メッセージにその手順を書いてある。
 */
const RE_DIFF = [
  "playwright-core の実装と食い違っている。",
  "`playwright-core/lib/coreBundle.js` の `kAncestorPreventingLandmark` /",
  "`validRoles` を読み直し、`src/test/bannerLandmarks.ts` の定数を合わせること",
  "(合わせないと jsdom の主ゲートと E2E の判定規則がずれ、片方だけ緑になる)。",
].join("");

/**
 * `playwright-core` のバンドル全文。
 *
 * 解決は**必ず `@playwright/test` を起点にする**。裏取り役の E2E が使うのはその依存として
 * 入った `playwright-core` であり、直接依存として宣言し直すと別バージョンが入りうる
 * (=「E2E と同じ規則か」を検査しているつもりで別物を読む)。宣言済みの依存だけを辿るので
 * knip の未宣言依存にもならない。
 *
 * `lib/` は package.json の `exports` に載っていないためサブパスは直接 `resolve` できない。
 * エントリの解決結果からパッケージルートを割り出して読む。
 */
function coreBundle(): string {
  const fromPlaywrightTest = createRequire(
    createRequire(import.meta.url).resolve("@playwright/test"),
  );
  const bundlePath = join(
    dirname(fromPlaywrightTest.resolve("playwright-core")),
    "lib/coreBundle.js",
  );
  if (!existsSync(bundlePath)) {
    throw new Error(`${bundlePath} が無い。${RE_DIFF}`);
  }
  return readFileSync(bundlePath, "utf8");
}

describe("bannerLandmarks の定数と playwright-core の同期(#431)", () => {
  const bundle = coreBundle();

  it("祖先条件は kAncestorPreventingLandmark と一致する", () => {
    const match = bundle.match(
      /var kAncestorPreventingLandmark = "((?:[^"\\]|\\.)*)"/,
    );
    expect(
      match,
      `kAncestorPreventingLandmark を抽出できない。${RE_DIFF}`,
    ).not.toBeNull();

    expect(match?.[1], RE_DIFF).toBe(BANNER_SUPPRESSING_ANCESTORS);
  });

  it("妥当なロール一覧は validRoles と一致する", () => {
    const match = bundle.match(/var validRoles = \[([^\]]*)\]/);
    expect(match, `validRoles を抽出できない。${RE_DIFF}`).not.toBeNull();

    const roles = [...(match?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(
      roles.length,
      `validRoles を 1 件も抽出できていない。${RE_DIFF}`,
    ).toBeGreaterThan(0);

    // 差分を両方向で見る(欠けも余りも同じ重さ)。
    expect([...VALID_ROLES].sort(), RE_DIFF).toEqual([...roles].sort());
  });
});
