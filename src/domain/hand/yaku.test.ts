/**
 * 役判定(`yaku.ts`)の網羅テスト(issue #113 / spec 3.0)。
 *
 * `win.test.ts` の happy-path を補完し、spec 3.0 が完了基準・注記で名指しする確定挙動に
 * 回帰テストを敷く:
 * - 北(ガリ)役牌除外の明示ガード(#83-3): 北刻子は役牌0翻・対々/混一/字一色/大四喜には寄与。
 * - 三暗刻/四暗刻のロン明刻降格(降格する/しない両方)。
 * - ナシナシ後付けの門前ダマ経路(spec 3.0「門前・副露の双方に適用」)。
 * - 平和の4否定条件(役牌雀頭・ペンチャン・カンチャン・副露)。
 * - 役表(一気通貫/三色同刻/一盃口/二盃口/純全帯么九/混老頭/小三元/三槓子)・
 *   文脈役(ダブル立直/一発/海底/嶺上/槍槓)・役満群の成立。
 *
 * 期待値はすべて `documents/spec/scoring-and-settlement.md` 3.0 の役表・注記から導いた。
 * 検証は公開オーケストレータ {@link analyzeWin}(= `yaku.ts` を経由)で行う。
 */

import { describe, expect, it } from "vitest";
import { HONOR } from "../tiles/tile";
import type { Meld } from "./meld";
import { parseTile, parseTiles } from "./notation";
import { type WinContext, analyzeWin } from "./win";

function ids(ctx: WinContext): string[] {
  const analysis = analyzeWin(ctx);
  return analysis ? analysis.yaku.map((y) => y.id).sort() : [];
}

const pon = (notation: string): Meld => ({
  type: "pon",
  tiles: parseTiles(notation),
  concealed: false,
});

/** 明槓(副露のカン)。 */
const openKan = (notation: string): Meld => ({
  type: "kan",
  tiles: parseTiles(notation),
  concealed: false,
});

describe("天和/地和と特殊形の複合役満(#184)", () => {
  it.each([
    ["heaven", "tenhou"],
    ["earth", "chiihou"],
  ] as const)("国士無双+%sを2倍役満として合算する", (blessing, id) => {
    const analysis = analyzeWin({
      concealedTiles: parseTiles("119m 19p 19s 1234567z"),
      winningTile: parseTile("1m"),
      winType: "tsumo",
      blessing,
    });
    expect(analysis?.yaku.map((y) => y.id)).toEqual(
      expect.arrayContaining([id, "kokushi"]),
    );
    expect(analysis?.yakuman).toBe(2);
  });

  it("通常形でも天和と構成役満を合算する", () => {
    const analysis = analyzeWin({
      concealedTiles: parseTiles("555z 666z 777z 111p 99p"),
      winningTile: parseTile("9p"),
      winType: "tsumo",
      blessing: "heaven",
    });
    expect(analysis?.yaku.map((y) => y.id)).toEqual(
      expect.arrayContaining(["tenhou", "daisangen"]),
    );
    expect(analysis?.yakuman).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// 北(ガリ)役牌除外の明示ガード(spec 3.0 #83-3)
// ---------------------------------------------------------------------------

describe("北刻子の役牌除外(spec 3.0 #83-3・明示ガード)", () => {
  it("北刻子は役牌0翻(対々和・混一色には寄与する)", () => {
    // 444z(北)刻子 + 筒子刻子3つ → 混一色 + 対々和。北は役牌にならない。
    const ctx: WinContext = {
      concealedTiles: parseTiles("444z 111p 222p 333p 99p"),
      winningTile: parseTile("9p"),
      winType: "tsumo",
    };
    const got = ids(ctx);
    expect(got).toContain("toitoi");
    expect(got).toContain("honitsu");
    expect(got).not.toContain("yakuhai_round_wind");
    expect(got).not.toContain("yakuhai_seat_wind");
  });

  it("誤って場風/自風に北(HONOR.NORTH)を渡しても北刻子に役牌翻が付かない(ガード)", () => {
    // 四人回し(北家=抜け番)で風割り当てを誤り、roundWind/seatWind に北を渡した想定。
    // 明示ガードが無ければ北刻子に役牌2翻(場風+自風)が付く潜在バグ。ガードで除外する。
    const ctx: WinContext = {
      concealedTiles: parseTiles("444z 111p 222p 333p 99p"),
      winningTile: parseTile("9p"),
      winType: "tsumo",
      roundWind: HONOR.NORTH,
      seatWind: HONOR.NORTH,
    };
    const got = ids(ctx);
    expect(got).not.toContain("yakuhai_round_wind");
    expect(got).not.toContain("yakuhai_seat_wind");
    // 手役(対々和・混一色)自体は影響を受けない。
    expect(got).toContain("toitoi");
    expect(got).toContain("honitsu");
  });

  it("北刻子は字一色(役満)の構成要素になり得る", () => {
    // 全字牌: 北(444z)刻子 + 白發中刻子 + 東雀頭 → 字一色。
    const analysis = analyzeWin({
      concealedTiles: parseTiles("444z 555z 666z 777z 11z"),
      winningTile: parseTile("1z"),
      winType: "tsumo",
    });
    expect(analysis?.isYakuman).toBe(true);
    expect(analysis?.yaku.map((y) => y.id)).toContain("tsuuiisou");
  });

  it("北刻子は大四喜(役満)の四風牌の一つになり得る", () => {
    const analysis = analyzeWin({
      concealedTiles: parseTiles("111z 222z 333z 444z 55p"),
      winningTile: parseTile("5p"),
      winType: "tsumo",
    });
    expect(analysis?.isYakuman).toBe(true);
    expect(analysis?.yaku.map((y) => y.id)).toContain("daisuushii");
    expect(analysis?.pao).toContain("daisuushii");
  });
});

// ---------------------------------------------------------------------------
// 三暗刻/四暗刻のロン明刻降格(spec 3.0 三暗刻行)
// ---------------------------------------------------------------------------

describe("暗刻のロン明刻降格(spec 3.0)", () => {
  it("四暗刻がシャンポンロンで完成 → 三暗刻へ降格(役満にならない)", () => {
    // 777s をロンで完成(シャンポン)→ 777s は明刻扱い → 暗刻3 → 三暗刻+対々和。
    const analysis = analyzeWin({
      concealedTiles: parseTiles("111p 333p 555s 777s 99p"),
      winningTile: parseTile("7s"),
      winType: "ron",
    });
    expect(analysis?.isYakuman).toBe(false);
    const got = analysis?.yaku.map((y) => y.id) ?? [];
    expect(got).toContain("sanankou");
    expect(got).toContain("toitoi");
    expect(got).not.toContain("suuankou");
  });

  it("四暗刻単騎はロンでも降格しない(和了牌が雀頭を完成)", () => {
    // 9p 単騎ロン → 完成したのは雀頭であって刻子ではない → 暗刻4 維持 → 四暗刻。
    const analysis = analyzeWin({
      concealedTiles: parseTiles("111p 333p 555s 777s 99p"),
      winningTile: parseTile("9p"),
      winType: "ron",
    });
    expect(analysis?.isYakuman).toBe(true);
    expect(analysis?.yaku.map((y) => y.id)).toContain("suuankou");
  });

  it("暗刻3+ポン1のシャンポンロンで暗刻完成 → 三暗刻は付かず対々和のみ", () => {
    // 555s(暗刻)をロン完成 → 明刻降格で暗刻2 → 三暗刻不成立。対々和は残る。
    const analysis = analyzeWin({
      concealedTiles: parseTiles("111p 333p 555s 99p"),
      melds: [pon("777s")],
      winningTile: parseTile("5s"),
      winType: "ron",
    });
    const got = analysis?.yaku.map((y) => y.id) ?? [];
    expect(got).toContain("toitoi");
    expect(got).not.toContain("sanankou");
  });

  it("和了牌が順子を完成させたロンは暗刻降格しない(三暗刻維持)", () => {
    // 暗刻3(111p/333p/555s)+ 678s 順子。ロン6sは順子を完成 → 刻子は降格せず三暗刻。
    const analysis = analyzeWin({
      concealedTiles: parseTiles("111p 333p 555s 678s 99p"),
      winningTile: parseTile("6s"),
      winType: "ron",
    });
    expect(analysis?.yaku.map((y) => y.id)).toContain("sanankou");
  });
});

// ---------------------------------------------------------------------------
// ナシナシ後付け: 門前ダマ経路(spec 3.0「門前・副露の双方に適用」)
// ---------------------------------------------------------------------------

describe("ナシナシ後付け・門前ダマ(spec 3.0 #83-2)", () => {
  it("門前ダマで唯一の役が和了牌完成の役牌暗刻 → 和了不可", () => {
    // 555z(白)をシャンポンロンで完成。門前・ダマで他に役なし → 後付け無効。
    const ctx: WinContext = {
      concealedTiles: parseTiles("555z 234p 567s 678s 99p"),
      winningTile: parseTile("5z"),
      winType: "ron",
    };
    expect(analyzeWin(ctx)).toBeNull();
  });

  it("門前で役牌暗刻が和了前に確定済み(和了牌は雀頭)なら和了可", () => {
    // 555z は既に確定、9p 単騎ロンで雀頭完成 → 後付けに当たらず有効。
    const analysis = analyzeWin({
      concealedTiles: parseTiles("555z 234p 567s 678s 99p"),
      winningTile: parseTile("9p"),
      winType: "ron",
    });
    expect(analysis).not.toBeNull();
    expect(analysis?.yaku.map((y) => y.id)).toContain("yakuhai_dragon_5");
  });

  it("門前ダマの後付け役牌でも立直が別の役を与えれば和了可", () => {
    // 同形をリーチ済みでロン → 立直が非後付け役を提供 → 和了可。
    const analysis = analyzeWin({
      concealedTiles: parseTiles("555z 234p 567s 678s 99p"),
      winningTile: parseTile("5z"),
      winType: "ron",
      riichi: true,
    });
    expect(analysis).not.toBeNull();
    expect(analysis?.yaku.map((y) => y.id)).toContain("riichi");
  });
});

// ---------------------------------------------------------------------------
// 平和の否定条件(spec 3.0 平和行: 門前・4順子・非役牌雀頭・両面待ち)
// ---------------------------------------------------------------------------

describe("平和の否定条件(spec 3.0)", () => {
  it("役牌(三元牌)雀頭は平和にならない", () => {
    // 4順子・両面待ちだが雀頭が白(役牌)→ 平和否定。
    const got = ids({
      concealedTiles: parseTiles("234p 567p 234s 678s 55z"),
      winningTile: parseTile("4p"),
      winType: "tsumo",
    });
    expect(got).not.toContain("pinfu");
    expect(got).toContain("menzen_tsumo");
  });

  it("ペンチャン待ちは平和にならない", () => {
    // 89p の 7p 待ち(ペンチャン)→ 平和否定。
    const got = ids({
      concealedTiles: parseTiles("123p 789p 234s 678s 55p"),
      winningTile: parseTile("7p"),
      winType: "tsumo",
    });
    expect(got).not.toContain("pinfu");
    expect(got).toContain("menzen_tsumo");
  });

  it("カンチャン待ちは平和にならない", () => {
    // 24p の 3p 待ち(カンチャン)→ 平和否定。
    const got = ids({
      concealedTiles: parseTiles("234p 567p 234s 678s 55p"),
      winningTile: parseTile("3p"),
      winType: "tsumo",
    });
    expect(got).not.toContain("pinfu");
    // 和了自体は断么九・門前ツモで成立(pinfu だけが落ちることを担保)。
    expect(got).toContain("menzen_tsumo");
  });

  it("単騎待ち(雀頭完成)は平和にならない", () => {
    // 99p 単騎ツモ → 和了牌は雀頭を完成させ順子でない → 平和否定。
    const got = ids({
      concealedTiles: parseTiles("234p 567p 234s 678s 99p"),
      winningTile: parseTile("9p"),
      winType: "tsumo",
    });
    expect(got).not.toContain("pinfu");
    expect(got).toContain("menzen_tsumo");
  });

  it("副露手は平和にならない(門前限定)", () => {
    // 白ポンの副露手 → 門前でないので平和不成立。
    const got = ids({
      concealedTiles: parseTiles("234p 567p 678p 55p"),
      melds: [pon("555z")],
      winningTile: parseTile("2p"),
      winType: "ron",
    });
    expect(got).not.toContain("pinfu");
    expect(got).toContain("yakuhai_dragon_5");
  });

  it("門前・非役牌雀頭・両面待ちなら平和成立(対照)", () => {
    const got = ids({
      concealedTiles: parseTiles("234p 567p 234s 678s 99p"),
      winningTile: parseTile("4p"),
      winType: "ron",
    });
    expect(got).toContain("pinfu");
  });
});

// ---------------------------------------------------------------------------
// 通常役の役表(spec 3.0)
// ---------------------------------------------------------------------------

describe("通常役の成立(spec 3.0 役表)", () => {
  it("一気通貫は門前2翻(筒子 123/456/789)", () => {
    const analysis = analyzeWin({
      concealedTiles: parseTiles("123p 456p 789p 234s 55s"),
      winningTile: parseTile("9p"),
      winType: "tsumo",
    });
    expect(analysis?.yaku.find((y) => y.id === "ittsuu")?.han).toBe(2);
  });

  it("一気通貫は副露で喰い下がり1翻", () => {
    const analysis = analyzeWin({
      concealedTiles: parseTiles("123p 456p 789p 55s"),
      melds: [pon("222s")],
      winningTile: parseTile("9p"),
      winType: "ron",
    });
    expect(analysis?.yaku.find((y) => y.id === "ittsuu")?.han).toBe(1);
  });

  it("三色同刻は rank 1 の刻子3スート一致で成立", () => {
    // 一萬・一筒・一索の刻子(サンマの萬子は 1/9 のみ → 三色同刻は rank 1/9 限定)。
    const got = ids({
      concealedTiles: parseTiles("111m 111p 111s 234p 99p"),
      winningTile: parseTile("2p"),
      winType: "tsumo",
    });
    expect(got).toContain("sanshoku_doukou");
  });

  it("一盃口は門前で同一順子2組(2組ちょうど)", () => {
    const got = ids({
      concealedTiles: parseTiles("234p 234p 567s 789s 55p"),
      winningTile: parseTile("5s"),
      winType: "tsumo",
    });
    expect(got).toContain("iipeikou");
    expect(got).not.toContain("ryanpeikou");
  });

  it("二盃口は同一順子2組×2 → 七対子より高点(最良形選択)", () => {
    // 234p234p678s678s55p は七対子(2翻)にも読めるが、二盃口(3翻)を採用する。
    const analysis = analyzeWin({
      concealedTiles: parseTiles("234p 234p 678s 678s 55p"),
      winningTile: parseTile("4p"),
      winType: "tsumo",
    });
    const got = analysis?.yaku.map((y) => y.id) ?? [];
    expect(got).toContain("ryanpeikou");
    expect(got).not.toContain("iipeikou");
    expect(got).not.toContain("chiitoitsu");
    expect(analysis?.han).toBeGreaterThanOrEqual(3);
  });

  it("純全帯么九は門前3翻(全グループ么九・字牌なし)", () => {
    const analysis = analyzeWin({
      concealedTiles: parseTiles("123p 789p 123s 789s 99p"),
      winningTile: parseTile("3p"),
      winType: "tsumo",
    });
    expect(analysis?.yaku.find((y) => y.id === "junchan")?.han).toBe(3);
    expect(analysis?.yaku.map((y) => y.id)).not.toContain("chanta");
  });

  it("混老頭は全么九(字牌混在)の刻子形で成立", () => {
    // 東南西の刻子 + 9p刻子 + 9m雀頭 → 全么九・字牌混在 → 混老頭 + 対々和。
    const got = ids({
      concealedTiles: parseTiles("111z 222z 333z 999p 99m"),
      winningTile: parseTile("9m"),
      winType: "tsumo",
    });
    expect(got).toContain("honroutou");
    expect(got).toContain("toitoi");
  });

  it("小三元は三元牌2刻子+三元牌雀頭で成立", () => {
    const got = ids({
      concealedTiles: parseTiles("555z 666z 234p 234s 77z"),
      winningTile: parseTile("2p"),
      winType: "tsumo",
    });
    expect(got).toContain("shousangen");
  });

  it("三槓子は槓子3つで成立", () => {
    const got = ids({
      concealedTiles: parseTiles("234s 99s"),
      melds: [openKan("1111p"), openKan("9999p"), openKan("1111s")],
      winningTile: parseTile("4s"),
      winType: "ron",
    });
    expect(got).toContain("sankantsu");
  });
});

// ---------------------------------------------------------------------------
// 文脈役(spec 3.0: リーチ・一発・海底・嶺上・槍槓)
// ---------------------------------------------------------------------------

describe("文脈役の成立(spec 3.0)", () => {
  const base = (over: Partial<WinContext>): WinContext => ({
    concealedTiles: parseTiles("234p 567p 234s 678s 99p"),
    winningTile: parseTile("4p"),
    winType: "tsumo",
    ...over,
  });

  it("ダブル立直は2翻・立直とは排他", () => {
    const got = ids(base({ doubleRiichi: true }));
    expect(got).toContain("double_riichi");
    expect(got).not.toContain("riichi");
  });

  it("立直+一発が同時成立する", () => {
    const got = ids(base({ riichi: true, ippatsu: true }));
    expect(got).toContain("riichi");
    expect(got).toContain("ippatsu");
  });

  it("一発は立直が無ければ付かない(要立直ガード)", () => {
    const got = ids(base({ ippatsu: true }));
    expect(got).not.toContain("ippatsu");
    // 手自体は門前ツモ等で和了可(一発だけが落ちる)。
    expect(got).toContain("menzen_tsumo");
  });

  it("海底摸月(最終自摸)が成立する", () => {
    expect(ids(base({ haitei: true }))).toContain("haitei");
  });

  it("嶺上開花が成立する", () => {
    expect(ids(base({ rinshan: true }))).toContain("rinshan");
  });

  it("槍槓が成立する(ロン)", () => {
    const got = ids(base({ winType: "ron", chankan: true }));
    expect(got).toContain("chankan");
  });
});

// ---------------------------------------------------------------------------
// 役満群(spec 3.0: 一律シングル yakuman=1)
// ---------------------------------------------------------------------------

describe("役満群の成立(spec 3.0・一律シングル)", () => {
  it("小四喜(風牌3刻子+風牌雀頭)", () => {
    const analysis = analyzeWin({
      concealedTiles: parseTiles("111z 222z 333z 234p 44z"),
      winningTile: parseTile("2p"),
      winType: "tsumo",
    });
    expect(analysis?.isYakuman).toBe(true);
    expect(analysis?.yaku.map((y) => y.id)).toContain("shousuushii");
  });

  it("清老頭(全1・9牌)", () => {
    const analysis = analyzeWin({
      concealedTiles: parseTiles("111m 999m 111p 999p 99s"),
      winningTile: parseTile("9s"),
      winType: "tsumo",
    });
    expect(analysis?.isYakuman).toBe(true);
    expect(analysis?.yaku.map((y) => y.id)).toContain("chinroutou");
  });

  it("緑一色(索子2/3/4/6/8 と發)", () => {
    const analysis = analyzeWin({
      concealedTiles: parseTiles("234s 234s 666s 888s 66z"),
      winningTile: parseTile("6z"),
      winType: "tsumo",
    });
    expect(analysis?.isYakuman).toBe(true);
    expect(analysis?.yaku.map((y) => y.id)).toContain("ryuuiisou");
  });

  it("四槓子(槓子4つ・パオ対象)", () => {
    const analysis = analyzeWin({
      concealedTiles: parseTiles("99m"),
      melds: [
        openKan("1111p"),
        openKan("9999p"),
        openKan("1111s"),
        openKan("9999s"),
      ],
      winningTile: parseTile("9m"),
      winType: "tsumo",
    });
    expect(analysis?.isYakuman).toBe(true);
    expect(analysis?.yaku.map((y) => y.id)).toContain("suukantsu");
    expect(analysis?.pao).toContain("suukantsu");
  });

  it("九蓮宝燈(門前・清一色 1112345678999+α)", () => {
    const analysis = analyzeWin({
      concealedTiles: parseTiles("11123455678999p"),
      winningTile: parseTile("5p"),
      winType: "tsumo",
    });
    expect(analysis?.isYakuman).toBe(true);
    expect(analysis?.yaku.map((y) => y.id)).toContain("chuuren");
  });
});
