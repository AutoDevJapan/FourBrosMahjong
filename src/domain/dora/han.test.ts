import { describe, expect, it } from "vitest";
import { HONOR, type Suit, type Tile } from "../tiles/tile";
import { createDoraSet, type DoraSet } from "./doraSet";
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

// Q16(二重取りする / 天鳳サンマ流): ドラ表示牌=西 → 次牌写像で実ドラ=北。
// このとき抜いた北(ガリ)は ガリ翻 + 表(+リーチ時は裏)ドラ翻として二重計上する。
describe("countDoraHan — 抜き北 × 実ドラ北の二重取り(Q16)", () => {
  const west = () => t("honor", HONOR.WEST); // 表示牌=西
  const north = () => t("honor", HONOR.NORTH); // 実ドラ=北
  const pin1 = () => t("pin", 1); // 裏表示牌ダミー(実ドラ=pin2、北に非該当)

  // 表:西→北 / 裏:pin1→pin2(北に該当させない)。roll [3,5] は非ゾロ目=count 1。
  const OMOTE_NORTH: DoraSet = createDoraSet([west(), pin1()], [3, 5]);
  // 表・裏ともに 西→北(count 1: 表1枚・裏1枚とも西表示牌)。roll [3,5]=非ゾロ目。
  const OMOTE_URA_NORTH: DoraSet = createDoraSet([west(), west()], [3, 5]);

  it("非リーチ: 抜き北2枚がガリ2翻 + 表ドラ2翻として二重計上される", () => {
    const breakdown = countDoraHan({
      hand: [t("man", 1), t("sou", 3)], // 手牌に北なし・ドラ非該当
      doraSet: OMOTE_NORTH,
      riichi: false,
      kitaCount: 2,
    });
    expect(breakdown.gari).toBe(2); // ガリ枠
    expect(breakdown.omote).toBe(2); // 抜き北が表ドラ北にも該当
    expect(breakdown.ura).toBe(0); // 非リーチ
    expect(breakdown.aka).toBe(0);
    expect(breakdown.total).toBe(4);
  });

  it("リーチ: 抜き北2枚がガリ2翻 + 表ドラ2翻 + 裏ドラ2翻として三重計上される", () => {
    const breakdown = countDoraHan({
      hand: [t("man", 1)],
      doraSet: OMOTE_URA_NORTH,
      riichi: true,
      kitaCount: 2,
    });
    expect(breakdown.gari).toBe(2);
    expect(breakdown.omote).toBe(2); // 抜き北2枚が表ドラ北に該当
    expect(breakdown.ura).toBe(2); // 抜き北2枚が裏ドラ北に該当
    expect(breakdown.total).toBe(6);
  });

  it("赤5とは独立: 表ドラ北(抜き)+ 赤5筒 が別枠で加算される", () => {
    const breakdown = countDoraHan({
      hand: [t("pin", 5, true)], // 赤5筒(北ドラには非該当)
      doraSet: OMOTE_NORTH,
      riichi: false,
      kitaCount: 1,
    });
    expect(breakdown.gari).toBe(1); // ガリ
    expect(breakdown.omote).toBe(1); // 抜き北=表ドラ北
    expect(breakdown.aka).toBe(1); // 赤5筒(独立)
    expect(breakdown.total).toBe(3);
  });

  it("手牌に残した北と抜いた北の両方が表ドラ北として数えられる", () => {
    const breakdown = countDoraHan({
      hand: [north()], // 抜かず手牌に残した北1枚
      doraSet: OMOTE_NORTH,
      riichi: false,
      kitaCount: 2, // 抜いた北2枚
    });
    expect(breakdown.gari).toBe(2);
    expect(breakdown.omote).toBe(3); // 手牌の北1 + 抜き北2
    expect(breakdown.total).toBe(5);
  });

  it("ドラ表示牌が西以外(実ドラ≠北)なら抜き北は二重取りされない", () => {
    // 表 pin1→pin2, sou2→sou3 のいずれも北ではない(DORA_SET_2)。
    const breakdown = countDoraHan({
      hand: [t("man", 1)],
      doraSet: DORA_SET_2,
      riichi: true,
      kitaCount: 3,
    });
    expect(breakdown.gari).toBe(3); // ガリのみ
    expect(breakdown.omote).toBe(0); // 抜き北は表ドラに数えない
    expect(breakdown.ura).toBe(0);
    expect(breakdown.total).toBe(3);
  });

  it("表示牌が北(実ドラ=東)のときは抜き北を二重取りしない(風牌巡回)", () => {
    // 表示牌=北 → 次牌写像で実ドラ=東。抜いた北はガリのみ。
    const northIndicator: DoraSet = createDoraSet([north(), pin1()], [3, 5]);
    const breakdown = countDoraHan({
      hand: [t("honor", HONOR.EAST)], // 実ドラ東を手牌に1枚
      doraSet: northIndicator,
      riichi: false,
      kitaCount: 2,
    });
    expect(breakdown.gari).toBe(2);
    expect(breakdown.omote).toBe(1); // 手牌の東のみ(抜き北は非該当)
    expect(breakdown.total).toBe(3);
  });

  it("抜き北0枚なら西表示でも二重取りは発生しない", () => {
    const breakdown = countDoraHan({
      hand: [t("man", 1)],
      doraSet: OMOTE_NORTH,
      riichi: true,
      kitaCount: 0,
    });
    expect(breakdown.gari).toBe(0);
    expect(breakdown.omote).toBe(0);
    expect(breakdown.ura).toBe(0);
    expect(breakdown.total).toBe(0);
  });
});
