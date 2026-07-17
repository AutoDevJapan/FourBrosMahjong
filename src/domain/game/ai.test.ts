import { describe, expect, it } from "vitest";
import { parseTiles } from "@/domain/hand/notation";
import type { Tile } from "@/domain/tiles/tile";
import { chooseDiscard, shanten, ukeire } from "./ai";

/** ツモ切り(引いた牌をそのまま切る)相当の打牌後13枚。 */
function afterTsumogiri(tiles14: readonly Tile[], drawn: Tile): Tile[] {
  const i = tiles14.findIndex(
    (t) =>
      t.suit === drawn.suit && t.rank === drawn.rank && t.isRed === drawn.isRed,
  );
  return [...tiles14.slice(0, i), ...tiles14.slice(i + 1)];
}

/** chooseDiscard の結果を反映した打牌後13枚。 */
function afterChoice(tiles14: readonly Tile[], chosen: Tile): Tile[] {
  const i = tiles14.findIndex(
    (t) =>
      t.suit === chosen.suit &&
      t.rank === chosen.rank &&
      t.isRed === chosen.isRed,
  );
  return [...tiles14.slice(0, i), ...tiles14.slice(i + 1)];
}

describe("ai: 向聴数(shanten)", () => {
  it("和了形は -1(標準形 4面子1雀頭)", () => {
    // 123p 456p 789p 234s 99s = 4面子1雀頭。
    expect(shanten(parseTiles("123p 456p 789p 234s 99s"))).toBe(-1);
  });

  it("テンパイは 0(両面待ち)", () => {
    // 123p 456p 789p 34s 99s → 2s/5s 待ち。
    expect(shanten(parseTiles("123p 456p 789p 34s 99s"))).toBe(0);
  });

  it("単騎テンパイも 0", () => {
    // 4面子 + 単騎。
    expect(shanten(parseTiles("123p 456p 789p 234s 9m"))).toBe(0);
  });

  it("七対子テンパイは 0", () => {
    expect(shanten(parseTiles("11p 22p 33p 44p 66s 77s 9m"))).toBe(0);
  });

  it("国士無双は么九のみで低向聴になる", () => {
    // 12種の么九 + 1対子(1m×2)、7z 待ち = 国士テンパイ(13 − 12 − 1 = 0)。
    expect(shanten(parseTiles("11m 9m 19p 19s 123456z"))).toBe(0);
  });

  it("バラバラの手は高向聴", () => {
    expect(shanten(parseTiles("19m 147p 369s 25s 135z"))).toBeGreaterThan(2);
  });
});

describe("ai: 受け入れ(ukeire)", () => {
  it("両面テンパイは 2種8枚を受け入れる", () => {
    // 34s の両面 → 2s(4枚)+ 5s(4枚)= 8枚。
    const r = ukeire(parseTiles("123p 456p 789p 34s 99s"));
    expect(r.kinds).toBe(2);
    expect(r.copies).toBe(8);
  });

  it("単騎テンパイは残り3枚のみを受け入れる", () => {
    const r = ukeire(parseTiles("123p 456p 789p 234s 9m"));
    expect(r.kinds).toBe(1);
    expect(r.copies).toBe(3);
  });
});

describe("ai: 打牌選択(chooseDiscard)", () => {
  it("有効牌を残し、孤立牌を切る(ツモ切りより向聴が良い or 同等)", () => {
    // テンパイ手 + 孤立字牌(中)。孤立牌を切ればテンパイ維持。
    const tiles = parseTiles("123p 456p 789p 34s 99s 7z");
    const drawn = tiles[tiles.length - 1]; // 7z を最後に引いたと仮定。
    const chosen = chooseDiscard({ tiles });
    // 孤立字牌(中)を切る。
    expect(chosen.suit).toBe("honor");
    expect(chosen.rank).toBe(7);
    // 打牌後はテンパイ(向聴0)を維持。
    expect(shanten(afterChoice(tiles, chosen))).toBe(0);
    // ツモ切りより悪化しない(この手ではツモ切りでもテンパイなので同等)。
    expect(shanten(afterChoice(tiles, chosen))).toBeLessThanOrEqual(
      shanten(afterTsumogiri(tiles, drawn)),
    );
  });

  it("受けの広いテンパイ形を壊さず孤立牌を切る", () => {
    // 3面子 + 両面(34s)+ 雀頭(99s)= テンパイ + 浮き 1m。1m を切る。
    const tiles = parseTiles("123p 456p 789p 34s 99s 1m");
    const chosen = chooseDiscard({ tiles });
    expect(chosen.suit).toBe("man");
    expect(chosen.rank).toBe(1);
    // 打牌後はテンパイ(向聴0)を維持。
    expect(shanten(afterChoice(tiles, chosen))).toBe(0);
  });

  it("同効率なら赤5(打点)を温存して素牌を切る", () => {
    // 4面子 + 赤5s + 9m の単騎二択。5s(赤)を残し 9m を切る。
    const tiles = parseTiles("123p 456p 789p 234s 5s 9m");
    const chosen = chooseDiscard({ tiles });
    expect(chosen.suit).toBe("man");
    expect(chosen.rank).toBe(9);
    // 赤5s は温存される。
    expect(afterChoice(tiles, chosen).some((t) => t.isRed)).toBe(true);
  });

  it("同効率なら表ドラを温存して素牌を切る", () => {
    // 1m と 9m の単騎二択。1m をドラ指定 → 9m を切る。
    const tiles = parseTiles("123p 456p 789p 234s 1m 9m");
    const doraKinds = new Set(["man-1"]);
    const chosen = chooseDiscard({ tiles, doraKinds });
    expect(chosen.rank).toBe(9);
  });

  it("同効率・同価値なら他家の現物(安全牌)を優先して切る", () => {
    // 東(1z)と西(3z)の単騎二択。東は他家が既に捨てている(現物)→ 東を切る。
    const tiles = parseTiles("123p 456p 789p 234s 1z 3z");
    const opponentDiscards = [parseTiles("1z 5p")]; // ある他家が 1z を捨て済み。
    const chosen = chooseDiscard({ tiles, opponentDiscards });
    expect(chosen.suit).toBe("honor");
    expect(chosen.rank).toBe(1);
  });

  it("多様な手でツモ切りより向聴が悪化しない(効率の担保)", () => {
    const hands = [
      "123p 456p 789p 34s 99s 7z",
      "112233p 456s 789s 1m 9m",
      "123p 456p 789s 12s 99s 1m",
      "111p 234p 567s 789s 5z 6z",
      "11p 44p 556677s 123p 9m",
    ];
    for (const notation of hands) {
      const tiles = parseTiles(notation);
      const drawn = tiles[tiles.length - 1];
      const chosen = chooseDiscard({ tiles });
      // chooseDiscard はツモ切りより向聴が良い or 同等(悪化しない)。
      expect(shanten(afterChoice(tiles, chosen))).toBeLessThanOrEqual(
        shanten(afterTsumogiri(tiles, drawn)),
      );
    }
  });
});
