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

describe("ai: 副露手の向聴補正(meldCount / #294)", () => {
  it("副露数を面子として加算する(3副露のテンパイと1向聴を区別する)", () => {
    // 3副露 + 門前 1p1p 4s6s = 嵌5s待ちテンパイ(0)。1p 4s 6s 3p は1向聴。
    // 未補正では両者とも 6 で同点になっていた(issue #294 の最小数値例)。
    expect(shanten(parseTiles("11p 46s"), 3)).toBe(0);
    expect(shanten(parseTiles("1p 46s 3p"), 3)).toBe(1);
    // 未補正(meldCount 省略)では同点に飽和する(バグの前提条件の固定化)。
    expect(shanten(parseTiles("11p 46s"))).toBe(
      shanten(parseTiles("1p 46s 3p")),
    );
  });

  it("副露手では七対子を評価しない(門前専用役)", () => {
    // 1副露 + 門前 1122p 334455s は標準形でテンパイ(1p/2p シャンポン待ち)。
    // 門前扱い(未補正)では標準形が飽和して 2 向聴になる。
    expect(shanten(parseTiles("1122p 334455s"), 1)).toBe(0);
    expect(shanten(parseTiles("1122p 334455s"))).toBe(2);
  });

  it("副露手では国士無双を評価しない(門前専用役)", () => {
    // 么九バラ10種は門前なら国士3向聴だが、1副露では標準形のみ(=6向聴)。
    const tiles = parseTiles("19m 19p 19s 1234z");
    expect(shanten(tiles)).toBe(3);
    expect(shanten(tiles, 1)).toBe(6);
  });

  it("受け入れも副露補正で数える: 3副露テンパイ(嵌5s待ち)は1種4枚", () => {
    const r = ukeire(parseTiles("11p 46s"), 3);
    expect(r.kinds).toBe(1);
    expect(r.copies).toBe(4);
  });

  it("seed196 再現局面: 嶺上3pツモ後、雀頭1pではなく3pを切ってテンパイを維持する", () => {
    // pon[發]+pon[2s]+暗槓[南] の3副露、門前 1p1p 4s6s + 嶺上ツモ 3p(待ち5s)。
    // 未補正では向聴が同点になり、現物(他家が1pを捨て済み)タイブレークで
    // 雀頭の1pを切ってノーテン化していた(issue #294 の決定的再現)。
    const tiles = parseTiles("11p 46s 3p");
    const chosen = chooseDiscard({
      tiles,
      meldCount: 3,
      opponentDiscards: [parseTiles("1p"), []],
    });
    expect(chosen.suit).toBe("pin");
    expect(chosen.rank).toBe(3);
    expect(shanten(afterChoice(tiles, chosen), 3)).toBe(0);
  });

  it("副露手でもテンパイ維持打牌があればテンパイを崩さない(近傍ケース)", () => {
    const cases: ReadonlyArray<{ notation: string; meldCount: number }> = [
      { notation: "11p 46s 3p", meldCount: 3 }, // 嵌張テンパイ + 浮き牌
      { notation: "11p 45s 9m", meldCount: 3 }, // 両面テンパイ + 浮き牌
      { notation: "123p 44s 67s 9m", meldCount: 2 }, // 2副露テンパイ + 浮き牌
      { notation: "123p 456s 44p 68s 9m", meldCount: 1 }, // 1副露テンパイ + 浮き牌
    ];
    for (const { notation, meldCount } of cases) {
      const tiles = parseTiles(notation);
      const chosen = chooseDiscard({ tiles, meldCount });
      expect(shanten(afterChoice(tiles, chosen), meldCount)).toBe(0);
    }
  });

  it("meldCount の異常値は 0..4 に正規化される(負数・小数・過大値)", () => {
    const tenpai = parseTiles("11p 46s");
    expect(shanten(tenpai, 3.9)).toBe(shanten(tenpai, 3));
    expect(shanten(tenpai, -1)).toBe(shanten(tenpai, 0));
    expect(shanten(parseTiles("9m"), 99)).toBe(shanten(parseTiles("9m"), 4));
  });

  it("牌数と副露数が不整合でも向聴は -1(和了)を下回らない", () => {
    // `leafShanten` の `useful` に下限が無いと `4 − 面子数` が負になり、向聴が -2 以下の
    // 不正値になる(門前で4面子1雀頭が揃った14枚へさらに副露数を加算した場合など)。
    // engine 経由では牌数と副露数が常に整合するため到達しないが、public API の防御として固定する。
    for (let melds = 0; melds <= 4; melds++) {
      expect(shanten(parseTiles("123m 456p 789s 111z 22z"), melds)).toBe(-1);
      expect(
        shanten(parseTiles("123m 456p 22z"), melds),
      ).toBeGreaterThanOrEqual(-1);
    }
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
