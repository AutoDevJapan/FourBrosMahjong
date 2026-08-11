/**
 * 赤扱いの層間契約(issue #485)。
 *
 * 「同じ牌が画面では非赤なのに得点では赤1翻」という食い違いを禁じる。表示層と得点
 * ドメインが赤5判定をそれぞれ実装していたのが原因で、判定は `@/domain/tiles/tile` の
 * `isRedDora` に一本化した。
 *
 * ここでは述語同士を直接比べない(同じ関数を両側から呼ぶだけの恒真テストになる)。
 * 表示側の**出力**(色付き `*-Dora` 素材 と `(赤ドラ)` ラベル)と得点側の**出力**
 * (`countDoraHan().aka`)を突き合わせるので、どちらかの層が判定を再実装した時点で失敗する。
 *
 * 赤扱いの残り2要素(赤枠・「赤」バッジ)は `Tile.tsx` が同じ `isRedDora` を通すため、
 * `Tile.test.tsx`(赤5萬・赤フラグ付き3筒でバッジが出ないこと)が担当する。
 * 本ファイルは DOM を持たない純関数の層間契約に絞る。
 *
 * 単一モジュールの単体テストではなく層をまたぐ契約なので、`tileImage.test.ts` /
 * `Tile.test.tsx` とは別ファイルに置く(`tileImage.ts` が消えても契約は残る)。
 */
import { describe, expect, it } from "vitest";
import { createDoraSet } from "@/domain/dora/doraSet";
import { countDoraHan } from "@/domain/dora/han";
import { createTile } from "@/domain/tiles/tile";
import type { TileData } from "../game/types";
import { resolveTileFace } from "./tileImage";
import { tileLabel } from "./tileLabel";

describe("赤扱いは表示層と得点ドメインで一致する(issue #485)", () => {
  // 表 pin1→pin2 / 裏 sou8→sou9。どちらも下の検証牌の牌種に該当させないので、
  // aka 以外のドラ翻が混ざらない([3,5] は非ゾロ目 = count 1)。
  const doraSet = createDoraSet(
    [createTile("pin", 1), createTile("sou", 8)],
    [3, 5],
  );

  /** 表示層が赤扱いしたか(色付き素材 と `(赤ドラ)` ラベルは常に同時に立つ)。 */
  function displayTreatsAsRed(tile: TileData): boolean {
    const face = resolveTileFace(tile);
    const redFace = face.kind === "image" && face.name.endsWith("-Dora");
    const redLabel = tileLabel(tile).includes("(赤ドラ)");
    expect(redFace).toBe(redLabel);
    return redLabel;
  }

  it.each<[string, TileData, boolean]>([
    ["赤5筒", { suit: "pin", rank: 5, isRed: true }, true],
    ["赤5索", { suit: "sou", rank: 5, isRed: true }, true],
    ["赤フラグ無しの5筒", { suit: "pin", rank: 5 }, false],
    ["赤5萬(仕様外・素材なし)", { suit: "man", rank: 5, isRed: true }, false],
    ["赤フラグ付き1萬(仕様外)", { suit: "man", rank: 1, isRed: true }, false],
    [
      "赤フラグ付き3筒(仕様外・非5)",
      { suit: "pin", rank: 3, isRed: true },
      false,
    ],
    [
      "赤フラグ付き字牌(仕様外)",
      { suit: "honor", rank: 1, isRed: true },
      false,
    ],
    // `%s` は引数を順に消費するため、2つ目を書くと `red` ではなく `tile` が
    // 描画される。ラベルだけに絞り、期待値は失敗時の差分から読む。
  ])("%s: 表示の赤扱いと赤ドラ翻が一致する", (_label, tile, red) => {
    expect(displayTreatsAsRed(tile)).toBe(red);
    expect(
      countDoraHan({
        // TileData は isRed 任意、Tile は必須。省略を非赤として詰め直す。
        hand: [{ ...tile, isRed: tile.isRed === true }],
        doraSet,
        riichi: false,
        kitaCount: 0,
      }).aka,
    ).toBe(red ? 1 : 0);
  });
});
