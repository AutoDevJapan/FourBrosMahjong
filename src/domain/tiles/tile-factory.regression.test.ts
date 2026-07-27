import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 牌ファクトリの単一起点を守る回帰テスト(issue #375)。
 *
 * 背景: 「オール赤5(5筒・5索は常に赤)」はルール SSOT
 * (`docs/四兄弟麻雀ルール.md` / スペック1 1.2・スペック4 4.4)由来の**牌の不変条件**だが、
 * `suit`/`rank` から `Tile` を組み立てる処理が独立に 6 か所へ実装されていた。
 * どれか1か所だけを直すと静かに不整合が生まれるため、`createTile`(`tiles/tile.ts`)へ集約した。
 *
 * 本テストは「また別の場所で組み立て直す」退行を検出する。
 * 対象は **`src/domain/` の本番コードのみ**(issue #375 の完了条件と一致):
 * - テストファイルは不変条件を**独立に検証する**側なので対象外
 *   (`createTile` を使って期待値を作ると検証が恒真になる)。
 * - `__oracle__/` は「本番へ依存しない独立オラクル」が検証価値の源泉のため対象外
 *   (意図的重複の理由は `__oracle__/generator.ts` の JSDoc に明記)。
 */

// `new URL(...).pathname` はパーセントエンコーディングを解かないため、リポジトリパスに
// 空白や非 ASCII を含むと壊れる。`vitest.config.ts` と同じく fileURLToPath を使う。
const DOMAIN = fileURLToPath(new URL("..", import.meta.url));

/** 不変条件を持ってよい唯一の本番ファイル(`DOMAIN` からの相対パス)。 */
const FACTORY = "tiles/tile.ts";

/**
 * `Tile` のオブジェクトリテラル生成を検出する。`Tile` は `isRed` が必須なので、
 * `isRed:` を書いている箇所は牌そのものを組み立てている(牌種 `{ suit, rank }` は該当しない)。
 *
 * `g` フラグ付き正規表現を定数で共有すると、`matchAll` は `lastIndex` を書き換えない
 * ものの**読み取りはする**ため、将来誰かが同じ定数へ `.test()` / `.exec()` を使うと
 * 以降の検出が静かに取りこぼす。毎回新しいインスタンスを返す関数にして事故を排除する。
 */
const tileLiteral = () => /\bisRed\s*:/g;

/**
 * 赤5判定そのものの再実装を検出する。
 * `RED_FIVE_SUITS` のような命名済みの集合と、`rank === 5` のインライン展開の両方を拾う
 * (旧 `engine.riichi-ankan.test.ts` は後者の形で重複していた)。
 *
 * 本ドメインで rank 5 に特別な意味があるのは赤5だけなので、`rank === 5` は赤5判定の
 * シグナルとして扱ってよい。字牌の白も rank 5 だが、`HONOR.WHITE` という記号で書く規約
 * (`tiles/tile.ts` / `hand/tile-identity.ts`)のためリテラル 5 とは衝突しない。
 */
const redFiveRule = () => /RED_FIVE_SUITS|\brank\s*===\s*5\b/g;

/** `src/domain` 配下の本番 .ts を再帰列挙(テスト・独立オラクルは除く)。 */
function productionFiles(dir: string, base = ""): string[] {
  const out: string[] = [];
  // withFileTypes はシンボリックリンクを追わないため、リンクループで無限再帰しない。
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === "__oracle__") continue;
      out.push(...productionFiles(join(dir, entry.name), rel));
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".ts") &&
      !/\.(test|spec)\.ts$/.test(entry.name)
    ) {
      out.push(rel);
    }
  }
  return out;
}

/** 対象ファイルから `re` にマッチする箇所を `path: matched` 形式で集める。 */
function offenders(re: () => RegExp): string[] {
  const found: string[] = [];
  for (const rel of productionFiles(DOMAIN)) {
    if (rel === FACTORY) continue;
    const text = readFileSync(join(DOMAIN, rel), "utf8");
    for (const m of text.matchAll(re())) found.push(`${rel}: ${m[0]}`);
  }
  return found;
}

describe("牌ファクトリの単一起点(issue #375)", () => {
  it("列挙対象に本番ファイルが実在する(走査が空振りしていない)", () => {
    // 相対パスの起点や除外条件を壊すと offenders が常に空になり、
    // 以降の検査が「常に成功する無意味なテスト」へ静かに退化するため先に固定する。
    const files = productionFiles(DOMAIN);
    expect(files).toContain(FACTORY);
    expect(files).toContain("hand/tenpai.ts");
    expect(files).toContain("game/ai.ts");
    expect(files).toContain("dora/indicator.ts");
    expect(files.some((f) => f.includes("__oracle__"))).toBe(false);
    expect(files.some((f) => /\.test\.ts$/.test(f))).toBe(false);
  });

  it("本番コードは tiles/tile.ts 以外で Tile を組み立てない", () => {
    const found = offenders(tileLiteral);
    expect(
      found,
      `Tile の組み立ては createTile(${FACTORY})に集約してください。\n` +
        found.join("\n"),
    ).toEqual([]);
  });

  it("本番コードは tiles/tile.ts 以外で赤5判定を再実装しない", () => {
    const found = offenders(redFiveRule);
    expect(
      found,
      `オール赤5の不変条件は createTile(${FACTORY})が唯一の定義元です。\n` +
        found.join("\n"),
    ).toEqual([]);
  });
});
