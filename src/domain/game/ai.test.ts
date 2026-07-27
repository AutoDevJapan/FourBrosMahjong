import { describe, expect, it } from "vitest";
import { makeRng, randomHand } from "@/domain/hand/__oracle__/generator";
import { parseTile, parseTiles, tileNotation } from "@/domain/hand/notation";
import { SANMA_TILE_KINDS, sameKind } from "@/domain/hand/tile-identity";
import type { Tile } from "@/domain/tiles/tile";
import { COPIES_PER_TILE } from "@/domain/tiles/tileSet";
import { chooseDiscard, MAX_MELD_COUNT, shanten, ukeire } from "./ai";

/** 副露手の受け入れ照合で、副露数ごとに検証する手牌数。 */
const MELD_UKEIRE_HANDS = 500;

/** 失敗時に手牌を特定するための簡易記法(例: "123p55z")。 */
function handNotation(tiles: readonly Tile[]): string {
  return [...tiles].map(tileNotation).sort().join("");
}

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

describe("ai: 喰い替え禁止牌の除外(forbiddenDiscards / #303)", () => {
  it("禁止された牌種は打牌候補にならない(喰い替え禁止 / #105)", () => {
    // 1副露 + 門前11枚(= 14 − 3×1)。3s は孤立牌で、禁止が無ければ必ず選ばれる。
    const tiles = parseTiles("123p 456p 78p 44m 3s");
    const forbidden = parseTiles("3s");
    expect(tiles).toHaveLength(11);
    // 前提の固定: 禁止しなければ 3s が選ばれる(= このテストが空振りしない)。
    expect(sameKind(chooseDiscard({ tiles, meldCount: 1 }), forbidden[0])).toBe(
      true,
    );

    const chosen = chooseDiscard({
      tiles,
      meldCount: 1,
      forbiddenDiscards: forbidden,
    });
    expect(sameKind(chosen, forbidden[0])).toBe(false);
  });

  it("禁止指定は赤フラグ非依存で効く(種別で比較する)", () => {
    // 手牌の 5p は赤(parseTiles の不変条件)。禁止側を素の 5p で渡しても除外される。
    // 1副露 + 門前11枚。赤5pは温存価値が最大だが、テンパイ維持が優先されて選ばれる。
    const tiles = parseTiles("123m 456m 78m 99s 5p");
    const plain5p: Tile = { suit: "pin", rank: 5, isRed: false };
    expect(tiles).toHaveLength(11);
    // 前提の固定: 禁止しなければ赤5pが選ばれる(赤敏感な比較へ退行すると落ちる)。
    expect(sameKind(chooseDiscard({ tiles, meldCount: 1 }), plain5p)).toBe(
      true,
    );

    const chosen = chooseDiscard({
      tiles,
      meldCount: 1,
      forbiddenDiscards: [plain5p],
    });
    expect(sameKind(chosen, plain5p)).toBe(false);
  });

  it("禁止牌も手牌の一部として向聴評価される(手牌から削らない)", () => {
    // 1副露 + 門前11枚(= 14 − 3×1)。3s は喰い替え禁止だが 345s の一部で、
    // これを手牌から削除して評価すると 1p3p の嵌張が見えなくなり 1p を切ってしまう。
    // 正しくは 6s を切って 2p 待ちのテンパイを維持する。
    const tiles = parseTiles("13567p 3456s 44m");
    const forbidden = parseTiles("3s");
    expect(tiles).toHaveLength(11);

    // テンパイを保てる打牌は 3s と 6s のみで、3s は禁止。よって 6s は「合法かつ
    // テンパイ維持」の唯一解であり、この牌の固定はタイブレーク依存ではない。
    const chosen = chooseDiscard({
      tiles,
      meldCount: 1,
      forbiddenDiscards: forbidden,
    });
    expect(chosen.suit).toBe("sou");
    expect(chosen.rank).toBe(6);
    expect(shanten(afterChoice(tiles, chosen), 1)).toBe(0);

    // 対照: 禁止牌を手牌から削除した旧実装はテンパイを落とす。
    // 本質は「打牌後の向聴が 0 にならない」ことであり、具体的にどの牌を選ぶかは
    // タイブレーク(打点温存・安全度・外側度)次第で変わりうるため固定しない。
    const deleted = tiles.filter((t) => !sameKind(t, forbidden[0]));
    const legacy = chooseDiscard({ tiles: deleted, meldCount: 1 });
    expect(shanten(afterChoice(tiles, legacy), 1)).toBeGreaterThan(0);
  });

  it("全ての牌種が禁止された場合は例外(呼び出し側の不整合)", () => {
    expect(() =>
      chooseDiscard({
        tiles: parseTiles("111m"),
        forbiddenDiscards: parseTiles("1m"),
      }),
    ).toThrow(/打牌可能な候補が無い/);
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

  it("国士テンパイでは未所持の么九牌も受け入れに含める(#368)", () => {
    // 中(7z)だけ未所持。字牌は同種以外の標準形候補にならないが、国士では4枚全て有効。
    const r = ukeire(parseTiles("11m 9m 19p 19s 123456z"));
    expect(r).toEqual({ kinds: 1, copies: 4 });
  });

  it("七対子1向聴では7種類目になり得る全未所持牌を含める(#368)", () => {
    // 6対子相当・6種類(1mは刻子)。未所持21種類のどれを引いても種類数が7となりテンパイ。
    const r = ukeire(parseTiles("111m 22p 44p 66p 88s 11z"));
    expect(r).toEqual({ kinds: 21, copies: 84 });
  });

  // 候補枝刈りが「全27牌種を走査した場合」と厳密同値であることの性質テスト(#368)。
  // 参照は同モジュールの `shanten` なので独立オラクル照合ではなく自己整合の検証であり、
  // 独立オラクルとの照合は `hand/cross-validation.test.ts` が門前手で担当する。
  // ここでは独立オラクルが `meldCount` を受け取れない副露手を受け持つ。
  it("副露数1〜4でも全27牌種走査と一致し、特殊形候補を混入しない(#368)", () => {
    const rng = makeRng(0x3680_0002);
    for (let meldCount = 1; meldCount <= MAX_MELD_COUNT; meldCount += 1) {
      for (let i = 0; i < MELD_UKEIRE_HANDS; i += 1) {
        const tiles = randomHand(rng, 13 - 3 * meldCount);
        const base = shanten(tiles, meldCount);
        let kinds = 0;
        let copies = 0;
        for (const kind of SANMA_TILE_KINDS) {
          const used = tiles.filter((tile) => sameKind(tile, kind)).length;
          if (used >= COPIES_PER_TILE) continue;
          const drawn = parseTile(tileNotation(kind));
          if (shanten([...tiles, drawn], meldCount) < base) {
            kinds += 1;
            copies += COPIES_PER_TILE - used;
          }
        }
        expect(ukeire(tiles, meldCount), handNotation(tiles)).toEqual({
          kinds,
          copies,
        });
      }
    }
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
