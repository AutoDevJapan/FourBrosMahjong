import { describe, expect, it } from "vitest";
import {
  decomposeSevenPairs,
  decomposeStandard,
  decomposeThirteenOrphans,
  isCompleteHand,
  type MeldInput,
} from "./decompose";
import { parseTiles } from "./notation";

describe("decomposeStandard", () => {
  it("4面子1雀頭を1通りに分解する", () => {
    const forms = decomposeStandard(parseTiles("123p 456p 789p 111s 99s"), []);
    expect(forms).toHaveLength(1);
    expect(forms[0].melds).toHaveLength(4);
    expect(forms[0].pair.startRank).toBe(9);
  });

  it("多面(刻子/順子の二義性)を全通り列挙する", () => {
    // 222333444p は [222][333][444] / [234][234][234] / (22雀頭+234+345+345) と読める。
    const forms = decomposeStandard(parseTiles("222333444p 55p 678s"), []);
    expect(forms.length).toBe(3);
    const kinds = forms.map((f) =>
      f.melds
        .filter((m) => m.suit === "pin")
        .map((m) => m.kind)
        .sort()
        .join(","),
    );
    expect(kinds).toContain("sequence,sequence,sequence");
    expect(kinds).toContain("triplet,triplet,triplet");
  });

  it("副露を面子として合成する", () => {
    const melds: MeldInput[] = [
      { tiles: parseTiles("111s"), isKan: false, concealed: false },
    ];
    // 副露1 → 門前は 3面子+雀頭(11枚)。
    const forms = decomposeStandard(parseTiles("123p 456p 789p 99s"), melds);
    expect(forms).toHaveLength(1);
    expect(forms[0].melds).toHaveLength(4);
  });

  it("ポン/カンの牌枚数・牌種が不正なら和了形として受理しない", () => {
    // 2枚しかない「ポン」を面子として数えると、実牌13枚の入力でも
    // 4面子1雀頭に見えてしまう。外部入力/型アサーション経由でも
    // この不正な面子をゲームドメインへ通さない。
    const malformedPon: MeldInput = {
      tiles: parseTiles("55z"),
      isKan: false,
      concealed: false,
    };
    const concealed = parseTiles("123p 456p 789p 99p");

    expect(decomposeStandard(concealed, [malformedPon])).toEqual([]);
    expect(isCompleteHand(concealed, [malformedPon])).toBe(false);
  });

  it("サンマに存在しない牌種を標準形へ分解しない", () => {
    // Tile は実行時検証を持たないため、型アサーションや記法経由で
    // 萬子2〜8が届いても、牌カタログ外の手として拒否する。
    const impossible = parseTiles("222m 333m 444m 555m 66m");

    expect(decomposeStandard(impossible, [])).toEqual([]);
    expect(isCompleteHand(impossible, [])).toBe(false);
  });

  it("サンマに存在しない副露牌も標準形へ合成しない", () => {
    const impossiblePon: MeldInput = {
      tiles: parseTiles("222m"),
      isKan: false,
      concealed: false,
    };

    expect(
      decomposeStandard(parseTiles("123p 456p 789p 99s"), [impossiblePon]),
    ).toEqual([]);
  });

  it("同一牌種が5枚以上ある入力を和了形として受理しない", () => {
    // 実在しない5枚の1筒を刻子+雀頭へ分けると、形だけは完成してしまう。
    const impossible = parseTiles("11111p 222s 333s 555z");

    expect(decomposeStandard(impossible, [])).toEqual([]);
    expect(isCompleteHand(impossible, [])).toBe(false);

    // 手牌と副露をまたぐ重複も同じ山の不変条件で拒否する。
    const duplicatedPon: MeldInput = {
      tiles: parseTiles("111p"),
      isKan: false,
      concealed: false,
    };
    expect(
      decomposeStandard(parseTiles("111p 222s 333s 55z"), [duplicatedPon]),
    ).toEqual([]);
  });

  it("萬子は順子を作れない(サンマ牌構成)", () => {
    // 1m9m は順子にならないため、この形は和了形にならない。
    expect(isCompleteHand(parseTiles("19m 123p 456p 789p 99s"), [])).toBe(
      false,
    );
  });

  it("和了形でない手は空配列", () => {
    expect(
      decomposeStandard(parseTiles("123p 456p 789p 135s 99s"), []),
    ).toHaveLength(0);
  });
});

describe("decomposeSevenPairs", () => {
  it("相異なる7対子を七対子と判定する", () => {
    const form = decomposeSevenPairs(
      parseTiles("11p 33p 22s 44s 66s 88s 77z"),
      [],
    );
    expect(form?.pairs).toHaveLength(7);
  });

  it("4枚使い(2対子扱い)は七対子にならない", () => {
    expect(
      decomposeSevenPairs(parseTiles("1111p 33p 55p 77p 22s 44s"), []),
    ).toBeNull();
  });

  it("副露があると成立しない", () => {
    const melds: MeldInput[] = [
      { tiles: parseTiles("111s"), isKan: false, concealed: false },
    ];
    expect(
      decomposeSevenPairs(parseTiles("11p 33p 55p 77p"), melds),
    ).toBeNull();
  });
});

describe("decomposeThirteenOrphans", () => {
  it("実在しない字牌 rank を国士無双として受け入れない", () => {
    const impossible = parseTiles("19m 19p 19s 1234568z 1m");

    expect(decomposeThirteenOrphans(impossible, [])).toBeNull();
    expect(isCompleteHand(impossible, [])).toBe(false);
  });

  it("13種の么九+1雀頭を国士無双と判定する", () => {
    const form = decomposeThirteenOrphans(
      parseTiles("19m 19p 19s 11234567z"),
      [],
    );
    expect(form?.kind).toBe("thirteenOrphans");
  });

  it("么九以外を含むと成立しない", () => {
    expect(
      decomposeThirteenOrphans(parseTiles("19m 19p 12s 11234567z"), []),
    ).toBeNull();
  });
});
