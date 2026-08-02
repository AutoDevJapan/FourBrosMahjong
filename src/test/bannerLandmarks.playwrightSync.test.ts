import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { BANNER_SUPPRESSING_ANCESTORS, VALID_ROLES } from "./bannerLandmarks";

/**
 * `bannerLandmarks()` が `playwright-core` から写した規則の**同期を機械で守る**(#431)。
 *
 * 対象は 3 点 — 祖先条件(`kAncestorPreventingLandmark`)、妥当ロール一覧(`validRoles`)、
 * そして `<header>` の暗黙ロール規則そのもの。定数だけを見ていると、規則側に条件が
 * 増えたときに定数は一致したまま判定だけがずれる。
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
 * 検査は `playwright-core` のバンドルから**字面**を取り出して突き合わせる。バンドルの
 * 書き方が変わればここが落ちるが、それは「Playwright 側の実装を読み直せ」という正しい合図
 * (黙って古い規則を使い続けるより良い)。失敗メッセージにその手順を書いてある。
 */
const RESYNC_HINT = [
  "playwright-core の実装と食い違っている。",
  "`playwright-core/lib/coreBundle.js` の `kAncestorPreventingLandmark` /",
  '`validRoles` / `"HEADER"` の規則を読み直し、',
  "`src/test/bannerLandmarks.ts` を合わせること",
  "(合わせないと jsdom の主ゲートと E2E の判定規則がずれ、片方だけ緑になる)。",
].join(" ");

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
  let packageRoot: string;
  try {
    const fromPlaywrightTest = createRequire(
      createRequire(import.meta.url).resolve("@playwright/test"),
    );
    packageRoot = dirname(fromPlaywrightTest.resolve("playwright-core"));
  } catch (cause) {
    // 素の MODULE_NOT_FOUND は収集時に投げられ、下の案内文へ辿り着けない。
    throw new Error(
      `@playwright/test 経由で playwright-core を解決できない。${RESYNC_HINT}`,
      { cause },
    );
  }
  const bundlePath = join(packageRoot, "lib/coreBundle.js");
  if (!existsSync(bundlePath)) {
    throw new Error(`${bundlePath} が無い。${RESYNC_HINT}`);
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
      `kAncestorPreventingLandmark を抽出できない。${RESYNC_HINT}`,
    ).not.toBeNull();

    expect(match?.[1], RESYNC_HINT).toBe(BANNER_SUPPRESSING_ANCESTORS);
  });

  it("妥当なロール一覧は validRoles と一致する", () => {
    const match = bundle.match(/var validRoles = \[([^\]]*)\]/);
    expect(match, `validRoles を抽出できない。${RESYNC_HINT}`).not.toBeNull();

    const roles = [...(match?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(
      roles.length,
      `validRoles を 1 件も抽出できていない。${RESYNC_HINT}`,
    ).toBeGreaterThan(0);

    // 差分を両方向で見る(欠けも余りも同じ重さ)。
    expect([...VALID_ROLES].sort(), RESYNC_HINT).toEqual([...roles].sort());
  });

  /**
   * 定数だけでなく**使い方の形**も固定する。`bannerLandmarks()` は
   * 「`<header>` は祖先条件に当たらなければ banner」という 1 行を写しているので、
   * Playwright がここへ条件を足したら(`FORM` は既に
   * `hasExplicitAccessibleName(e) ? "form" : null` と条件付き)、定数は一致したまま
   * 判定だけがずれる — M2 で塞いだ穴が 1 段上へ移るだけになる。
   */
  it("HEADER の暗黙ロール規則そのものが Playwright と同じ形である", () => {
    expect(bundle, RESYNC_HINT).toContain(
      '"HEADER": (e) => closestCrossShadow(e, kAncestorPreventingLandmark) ? null : "banner"',
    );
  });
});
