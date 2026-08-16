import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appRoutes, DEFAULT_APP_DIR } from "./appRoutes";

/**
 * `appRoutes()` 自身の回帰テスト。
 *
 * `appRoutes()` は #431 / #409 の 2 つのランドマークゲートが共有する「実在ルートの集合」の
 * 導出元で、**両ゲートの網羅性がこの 1 関数に乗っている**。ところが本リポジトリの `src/app` には
 * ルートグループもプライベートフォルダも動的セグメントも存在しないため、呼び出し側のテストを
 * いくら回しても**それらの分岐は一度も実行されない**。壊しても無音のまま「全ルート網羅」を
 * 名乗り続けることになるので、フィクスチャのディレクトリを直接渡して各分岐を固定する。
 *
 * `src/app` を直接いじる検査にはしない(実ルートを一時的に増やすと、同時に走る他のテストや
 * Next.js のビルドへ影響しうる)。
 */
const fixtures: string[] = [];

/** 空の `page.*` 群を持つ一時ディレクトリを作る。`entries` は appDir からの相対パス。 */
function makeAppDir(entries: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "app-routes-"));
  fixtures.push(dir);
  for (const entry of entries) {
    const file = join(dir, entry);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "");
  }
  return dir;
}

afterEach(() => {
  for (const dir of fixtures.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("appRoutes()(#409 / #431 のルート導出)", () => {
  it("既定の走査対象は実在し、引数なしの呼び出しがそこを見る", () => {
    // 定数の字面をもう一度書くのではなく、**実際に読めるディレクトリを指していること**と
    // **引数なしの経路がそれを走査していること**を見る(cwd がリポジトリ直下でなくなった、
    // ディレクトリを移した、といった壊れ方はどちらの呼び出し側テストでも原因が読めない)。
    expect(existsSync(DEFAULT_APP_DIR), `${DEFAULT_APP_DIR} が無い`).toBe(true);
    expect(appRoutes()).toEqual(appRoutes(DEFAULT_APP_DIR));
    expect(appRoutes()).toContain("/");
  });

  it("ネストしたページからルートパスを導出し、昇順で返す", () => {
    const dir = makeAppDir([
      "page.tsx",
      "history/page.tsx",
      "game/result/page.tsx",
      "game/page.tsx",
    ]);

    expect(appRoutes(dir)).toEqual(["/", "/game", "/game/result", "/history"]);
  });

  it("`.tsx` 以外の拡張子で足されたページも取りこぼさない", () => {
    // `.tsx` だけを見ていると、`page.js` で足されたルートが検査をすり抜ける。
    const dir = makeAppDir([
      "page.js",
      "a/page.jsx",
      "b/page.mjs",
      "c/page.ts",
    ]);

    expect(appRoutes(dir)).toEqual(["/", "/a", "/b", "/c"]);
  });

  it("ページ以外のファイルはルートにしない", () => {
    const dir = makeAppDir([
      "page.tsx",
      "layout.tsx",
      "not-found.tsx",
      "history/page.test.tsx",
      "history/MatchHistoryList.tsx",
    ]);

    expect(appRoutes(dir)).toEqual(["/"]);
  });

  it("ルートグループ `(name)` は URL に現れないのでセグメントごと落とす", () => {
    const dir = makeAppDir(["(marketing)/page.tsx", "(shop)/cart/page.tsx"]);

    expect(appRoutes(dir)).toEqual(["/", "/cart"]);
  });

  it("プライベートフォルダ `_name` 配下はエントリごと除外する", () => {
    // セグメントだけ落とすと `_drafts/preview/page.tsx` が `/preview` に化ける。
    const dir = makeAppDir([
      "page.tsx",
      "_drafts/preview/page.tsx",
      "settings/_parts/page.tsx",
    ]);

    expect(appRoutes(dir)).toEqual(["/"]);
  });

  it("動的セグメント `[param]` は推測せず例外にする", () => {
    const dir = makeAppDir(["page.tsx", "match/[id]/page.tsx"]);

    expect(() => appRoutes(dir)).toThrowError(/\[id\] は未対応/);
  });

  it("パラレルルート `@slot` は推測せず例外にする", () => {
    const dir = makeAppDir(["page.tsx", "@modal/page.tsx"]);

    expect(() => appRoutes(dir)).toThrowError(/@modal は未対応/);
  });

  it("ページファイルが 1 つも無ければ例外にする(走査の空振りを緑にしない)", () => {
    const dir = makeAppDir(["layout.tsx"]);

    expect(() => appRoutes(dir)).toThrowError(/ページファイルが 1 つも無い/);
  });
});
