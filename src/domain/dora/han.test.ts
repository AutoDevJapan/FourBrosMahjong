import { describe, expect, it } from "vitest";
import type { Suit, Tile } from "../tiles/tile";
import { type DoraSet, createDoraSet } from "./doraSet";
import { countDoraHan } from "./han";

function t(suit: Suit, rank: number, isRed = false): Tile {
  return { suit, rank, isRed };
}

// 表: pin1→pin2, sou2→sou3 / 裏: pin8→pin9, sou8→sou9(手牌に該当させない)
const DORA_SET_2: DoraSet = createDoraSet(
  [t("pin", 1), t("sou", 2), t("pin", 8), t("sou", 8)],
  [4, 4],
);

describe("countDoraHan", () => {
  it("[受け入れ基準] リーチ+表ドラ2枚+赤5×1+北2抜き / 裏ドラ該当なし", () => {
    const hand: Tile[] = [
      t("pin", 2), // 表ドラ該当
      t("sou", 3), // 表ドラ該当
      t("pin", 5, true), // 赤5筒
      t("man", 1), // ドラ非該当
      t("honor", 7), // ドラ非該当
    ];
    const breakdown = countDoraHan({
      hand,
      doraSet: DORA_SET_2,
      riichi: true,
      kitaCount: 2,
    });
    expect(breakdown.omote).toBe(2);
    expect(breakdown.ura).toBe(0); // 裏ドラ該当なし
    expect(breakdown.aka).toBe(1);
    expect(breakdown.gari).toBe(2);
    expect(breakdown.total).toBe(5);
  });

  it("同一実ドラ牌を複数枚持てば枚数分カウント(1枚1翻)", () => {
    const hand: Tile[] = [t("pin", 2), t("pin", 2), t("pin", 2)];
    const breakdown = countDoraHan({
      hand,
      doraSet: DORA_SET_2,
      riichi: false,
      kitaCount: 0,
    });
    expect(breakdown.omote).toBe(3);
    expect(breakdown.total).toBe(3);
  });

  it("非リーチなら裏ドラは加算されない", () => {
    // 裏 pin8→pin9 に該当する pin9 を持たせる。
    const hand: Tile[] = [t("pin", 9)];
    const notReach = countDoraHan({
      hand,
      doraSet: DORA_SET_2,
      riichi: false,
      kitaCount: 0,
    });
    expect(notReach.ura).toBe(0);

    const reach = countDoraHan({
      hand,
      doraSet: DORA_SET_2,
      riichi: true,
      kitaCount: 0,
    });
    expect(reach.ura).toBe(1);
  });

  it("赤5は牌種ドラと独立に加算(赤5がドラでもある場合は二重に翻)", () => {
    // 表 pin4→pin5 のドラセット。手牌の赤5筒は 表ドラ かつ 赤ドラ。
    const doraSet = createDoraSet([t("pin", 4), t("sou", 1)], [3, 5]);
    const hand: Tile[] = [t("pin", 5, true)];
    const breakdown = countDoraHan({
      hand,
      doraSet,
      riichi: false,
      kitaCount: 0,
    });
    expect(breakdown.omote).toBe(1); // 牌種一致(赤かどうかは無視)
    expect(breakdown.aka).toBe(1); // 赤5
    expect(breakdown.total).toBe(2);
  });

  it("ガリ(北抜き)は kitaCount 分そのまま加算", () => {
    const breakdown = countDoraHan({
      hand: [],
      doraSet: DORA_SET_2,
      riichi: false,
      kitaCount: 4,
    });
    expect(breakdown.gari).toBe(4);
    expect(breakdown.total).toBe(4);
  });

  it("ドラ皆無・北抜きなしなら total=0", () => {
    const breakdown = countDoraHan({
      hand: [t("man", 1), t("honor", 5)],
      doraSet: DORA_SET_2,
      riichi: true,
      kitaCount: 0,
    });
    expect(breakdown.total).toBe(0);
  });

  it("赤5索も赤ドラとして数える(オール赤5)", () => {
    const breakdown = countDoraHan({
      hand: [t("sou", 5, true), t("sou", 5, true)],
      doraSet: DORA_SET_2,
      riichi: false,
      kitaCount: 0,
    });
    expect(breakdown.aka).toBe(2);
  });

  it("kitaCount が負・非整数なら RangeError", () => {
    expect(() =>
      countDoraHan({
        hand: [],
        doraSet: DORA_SET_2,
        riichi: false,
        kitaCount: -1,
      }),
    ).toThrow(RangeError);
    expect(() =>
      countDoraHan({
        hand: [],
        doraSet: DORA_SET_2,
        riichi: false,
        kitaCount: 1.5,
      }),
    ).toThrow(RangeError);
  });
});
