import { describe, expect, it } from "vitest";
import { parseTiles } from "@/domain/hand/notation";
import { isRedDora, type Tile } from "@/domain/tiles/tile";
import { buildTileSet } from "@/domain/tiles/tileSet";
import { chooseDiscard } from "./ai";

/**
 * 打点温存価値の赤5判定が {@link isRedDora} に委ねられていることを固定する(issue #490)。
 *
 * #485(PR #487)で「赤ドラとしての意味づけは `tiles/tile.ts` の `isRedDora` が唯一の
 * 述語」という規約を立てたが、`ai.ts` の `valueOf` だけが生の `tile.isRed` を読み続けて
 * いた。`chooseDiscard` は `Tile[]` を受け取る**公開関数**で `Tile` に実行時検証は無いため、
 * `createTile` を経由しない構造的な値(復元データ・外部入力)が
 * `{ suit: "man", rank: 1, isRed: true }` を持ち込むと、仕様上存在しない赤5へ +2 が付いて
 * 打牌選択が歪む。
 *
 * ## 挙動不変であること(なぜ ADR-0002 の方策変更ではないか)
 *
 * 実運用の牌は必ず `buildTileSet()` → `createTile` 由来で、そこでは
 * `isRedDora(tile) === tile.isRed` が全牌で成り立つ(下の「山の全牌で同値」)。
 * よって正当な入力に対して `valueOf` の値は変わらず、AI の打牌は 1 手も変わらない。
 * seed 固定の半荘 120 回(全 1,756 局)の打牌・鳴き・リーチ・北抜き列が修正前後で
 * バイト一致することを確認済み(手順と結果は PR 本文 / ADR-0002 に記載)。
 */
describe("ai: 打点温存の赤5判定(issue #490)", () => {
  /**
   * 仕様外の「赤い1萬」。`createTile("man", 1).isRed` は必ず `false` なので、
   * この値は `createTile` を経由しない外部入力でしか作れない。
   */
  const FAKE_RED_MAN1: Tile = { suit: "man", rank: 1, isRed: true };

  it("仕様外の赤フラグ付き1萬は温存価値を得ない(赤5として扱わない)", () => {
    // 123p 456p 789p 234s = 4面子。残り 1m / 9m の単騎二択で、
    // 向聴・受け入れ(ともに単騎3枚)・安全度・外側度(ともに老頭)まで全て同点。
    // 決着は「打点温存 → 牌種キーの辞書順」に落ちる。
    const tiles = [...parseTiles("123p 456p 789p 234s 9m"), FAKE_RED_MAN1];
    expect(tiles).toHaveLength(14);

    // 温存価値が付かないので辞書順(man-1 < man-9)で 1m が切られる。
    // 修正前は 1m に +2 が付いて温存され、9m が切られていた。
    const chosen = chooseDiscard({ tiles });
    expect({ suit: chosen.suit, rank: chosen.rank }).toEqual({
      suit: "man",
      rank: 1,
    });

    // 赤フラグの有無で答えが変わらないこと(= フラグを見ていないこと)まで固定する。
    const plain = parseTiles("123p 456p 789p 234s 9m 1m");
    expect(plain).toHaveLength(14);
    const chosenPlain = chooseDiscard({ tiles: plain });
    expect({ suit: chosenPlain.suit, rank: chosenPlain.rank }).toEqual({
      suit: chosen.suit,
      rank: chosen.rank,
    });
  });

  it("正当な赤5(5筒)は従来どおり +2 で温存される(対照)", () => {
    // 上のテストが「赤判定を丸ごと消す」実装でも通ってしまわないよう、+2 が
    // 生きていることを同じ比較キー段で固定する。
    // 111m 999m 東東東 南南南 = 4面子。残り 5p(赤)/ 7s の単騎二択で、向聴・受け入れ
    // (どちらも数牌と繋がらない孤立単騎で 3 枚)・安全度・外側度(ともに中張牌で 0)が
    // 同点。温存価値だけが差になり、これを外すと辞書順(pin-5 < sou-7)で赤5筒が切られる。
    const tiles = parseTiles("111m 999m 111z 222z 5p 7s");
    expect(tiles).toHaveLength(14);
    expect(tiles.some((t) => t.suit === "pin" && t.rank === 5 && t.isRed)).toBe(
      true,
    );

    const chosen = chooseDiscard({ tiles });
    expect({ suit: chosen.suit, rank: chosen.rank }).toEqual({
      suit: "sou",
      rank: 7,
    });
  });

  it("山の全牌で `isRedDora(tile) === tile.isRed`(挙動不変の根拠)", () => {
    // 実運用の牌は必ずこの 108 枚(= createTile 由来)なので、生の `isRed` を読む
    // 旧実装と `isRedDora` を通す新実装は正当な入力に対して恒等に一致する。
    // この同値が崩れる変更(例: 赤5の対象スート変更)は AI の打点温存を静かに動かすため、
    // ここで落として ADR-0002 の更新を促す。
    const wall = buildTileSet();
    expect(wall).toHaveLength(108);
    const mismatched = wall.filter((t) => isRedDora(t) !== t.isRed);
    expect(mismatched).toEqual([]);
    // 同値が「両辺とも常に false」で成り立つ退化を防ぐ(赤5が実在すること)。
    expect(wall.filter((t) => isRedDora(t)).length).toBeGreaterThan(0);
  });
});
