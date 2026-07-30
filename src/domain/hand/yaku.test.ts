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
import { analyzeWin, type WinContext } from "./win";

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

describe("役満成立時の通常役吸収(#339)", () => {
  it("大三元の内訳から役牌・対々和等の通常役を除外する", () => {
    const analysis = analyzeWin({
      concealedTiles: parseTiles("555z 666z 777z 99p"),
      melds: [pon("111p")],
      winningTile: parseTile("9p"),
      winType: "tsumo",
    });

    expect(analysis?.yaku.map((y) => y.id)).toEqual(["daisangen"]);
    expect(analysis?.han).toBe(0);
    expect(analysis?.yakuman).toBe(1);
  });

  it("天和+大三元の複合役満は両方を保持し、通常役だけを除外する", () => {
    const analysis = analyzeWin({
      concealedTiles: parseTiles("555z 666z 777z 111p 99p"),
      winningTile: parseTile("9p"),
      winType: "tsumo",
      blessing: "heaven",
    });

    expect(analysis?.yaku.map((y) => y.id).sort()).toEqual([
      "daisangen",
      "suuankou",
      "tenhou",
    ]);
    expect(analysis?.han).toBe(0);
    expect(analysis?.yakuman).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 北(ガリ)役牌除外の明示ガード(spec 3.0 #83-3)
// ---------------------------------------------------------------------------

describe("北の役牌除外(刻子・雀頭)(spec 3.0 #83-3・明示ガード)", () => {
  it("北刻子は役牌0翻(対々和・混一色には寄与する)", () => {
    // 444z(北)刻子 + 筒子刻子3つ → 混一色 + 対々和。北は役牌にならない。
    const ctx: WinContext = {
      concealedTiles: parseTiles("444z 111p 222p 333p 99p"),
      winningTile: parseTile("3p"),
      winType: "ron",
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
      winningTile: parseTile("3p"),
      winType: "ron",
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

  it("誤って場風/自風に北を渡しても北雀頭は平和を否定しない(雀頭側ガード・#400)", () => {
    // 刻子側の上のテストと対になる雀頭側の契約。北は役牌ではないので、
    // 北雀頭は「役牌雀頭」として平和を否定してはならない(spec 3.0 #83-3)。
    // ガードが無いと `pairIsValue` が真になり平和が落ち、平和が唯一の役である
    // この手は「役なし」で和了不可(analyzeWin が null)になる。
    const base: WinContext = {
      concealedTiles: parseTiles("234p 567p 234s 678s 44z"),
      winningTile: parseTile("4p"),
      winType: "ron",
    };
    const withNorthWind = analyzeWin({
      ...base,
      roundWind: HONOR.NORTH,
      seatWind: HONOR.NORTH,
    });
    expect(withNorthWind).not.toBeNull();
    expect(withNorthWind?.yaku.map((y) => y.id)).toContain("pinfu");
    // 風を渡さない場合と同じ結果になる(北を風として渡しても影響が出ない)。
    // 両辺が null で vacuous に通らないよう、比較相手も非 null を明示する。
    const withoutWind = analyzeWin(base);
    expect(withoutWind).not.toBeNull();
    expect(withNorthWind?.yaku.map((y) => y.id)).toEqual(
      withoutWind?.yaku.map((y) => y.id),
    );
  });

  it("北以外の役牌雀頭(三元牌・場風・自風)は従来どおり平和を否定する(ガードの効き過ぎ防止)", () => {
    // 雀頭側ガードが北以外まで無効化していないことを対照で固定する
    // (このテストは回帰ガードではなく、過剰な修正を検出するための対照)。
    // 平和が唯一の役候補の手なので、否定されれば「役なし」で和了不可(null)まで固定する
    // — `ids` は null のとき [] を返すため、not.toContain だけでは vacuous に通り得る。
    const dragonPair = analyzeWin({
      concealedTiles: parseTiles("234p 567p 234s 678s 55z"),
      winningTile: parseTile("4p"),
      winType: "ron",
    });
    expect(dragonPair).toBeNull();
    // 場風/自風雀頭も同様に平和を否定する(東=HONOR.EAST)。
    const eastPair = analyzeWin({
      concealedTiles: parseTiles("234p 567p 234s 678s 11z"),
      winningTile: parseTile("4p"),
      winType: "ron",
      roundWind: HONOR.EAST,
      seatWind: HONOR.EAST,
    });
    expect(eastPair).toBeNull();
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

  // 北雀頭が小四喜の風牌雀頭として数えられること(役牌ではないが風牌ではある)は
  // 役満群の describe「小四喜(風牌3刻子+風牌雀頭)」で固定済み。

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
      winningTile: parseTile("9p"),
      winType: "ron",
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
    // 雀頭 44z = 北。「北は役牌にならないが風牌ではある」という spec 3.0 #83-3 の
    // 非対称の対句(→ 上の「北の役牌除外(刻子・雀頭)」describe)。
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

// ---------------------------------------------------------------------------
// spec 3.0 役表の翻を網羅的に固定する(#391)
// ---------------------------------------------------------------------------

/** 暗槓(門前を保つカン)。 */
const closedKan = (notation: string): Meld => ({
  type: "kan",
  tiles: parseTiles(notation),
  concealed: true,
});

/**
 * `documents/spec/scoring-and-settlement.md` 3.0「通常役」表の**転記**。
 * 表の左から順に `id → { 門前, 副露 }`。`open: null` は副露で成立しない役
 * (表の「—」)を表す。
 *
 * spec 3.0 は「実装は `src/domain/hand/yaku.ts` であり、**本表と一致させる**」と
 * 明記しているが、#391 の実測では表に載る翻値のうち実際に assert されていたのは
 * 5 箇所だけで、**翻を書き換えるミューテーションは全テストを素通り**していた
 * (残りは「役が成立すること(id を含むこと)」しか見ていなかった)。
 * 打点はソシー精算・順位・ウマへ伝播するため、ここで表全体を機械的に固定する。
 */
const SPEC_HAN = {
  riichi: { menzen: 1, open: null },
  double_riichi: { menzen: 2, open: null },
  ippatsu: { menzen: 1, open: null },
  menzen_tsumo: { menzen: 1, open: null },
  haitei: { menzen: 1, open: 1 },
  rinshan: { menzen: 1, open: 1 },
  chankan: { menzen: 1, open: 1 },
  tanyao: { menzen: 1, open: null },
  pinfu: { menzen: 1, open: null },
  iipeikou: { menzen: 1, open: null },
  ryanpeikou: { menzen: 3, open: null },
  yakuhai_dragon_5: { menzen: 1, open: 1 },
  yakuhai_dragon_6: { menzen: 1, open: 1 },
  yakuhai_dragon_7: { menzen: 1, open: 1 },
  yakuhai_round_wind: { menzen: 1, open: 1 },
  yakuhai_seat_wind: { menzen: 1, open: 1 },
  sanshoku_doukou: { menzen: 2, open: 2 },
  ittsuu: { menzen: 2, open: 1 },
  toitoi: { menzen: 2, open: 2 },
  sanankou: { menzen: 2, open: 2 },
  sankantsu: { menzen: 2, open: 2 },
  shousangen: { menzen: 2, open: 2 },
  chanta: { menzen: 2, open: 1 },
  junchan: { menzen: 3, open: 2 },
  honroutou: { menzen: 2, open: 2 },
  honitsu: { menzen: 3, open: 2 },
  chinitsu: { menzen: 6, open: 5 },
  chiitoitsu: { menzen: 2, open: null },
} as const satisfies Record<string, { menzen: number; open: number | null }>;

type SpecYakuId = keyof typeof SPEC_HAN;

/** 平和形の門前フィクスチャ(文脈役だけを乗せる土台として使う)。 */
const menzenBase = {
  concealedTiles: parseTiles("234p 567p 234s 678s 99p"),
  winningTile: parseTile("4p"),
} as const;
/** 白ポンの副露フィクスチャ(同上・副露側)。 */
const openBase = {
  concealedTiles: parseTiles("234p 567p 678p 55p"),
  melds: [pon("555z")],
  winningTile: parseTile("2p"),
} as const;

/**
 * 各役を成立させる最小フィクスチャ。翻は「その役の `han`」だけを見るので、
 * 手が他の役と複合していても構わない(複合しないフィクスチャを探す方が不自然)。
 */
const FIXTURES: Record<SpecYakuId, { menzen: WinContext; open?: WinContext }> =
  {
    riichi: {
      menzen: { ...menzenBase, winType: "ron", riichi: true },
    },
    double_riichi: {
      menzen: { ...menzenBase, winType: "ron", doubleRiichi: true },
    },
    ippatsu: {
      menzen: { ...menzenBase, winType: "ron", riichi: true, ippatsu: true },
    },
    menzen_tsumo: { menzen: { ...menzenBase, winType: "tsumo" } },
    haitei: {
      menzen: { ...menzenBase, winType: "tsumo", haitei: true },
      open: { ...openBase, winType: "ron", haitei: true },
    },
    rinshan: {
      menzen: { ...menzenBase, winType: "tsumo", rinshan: true },
      open: { ...openBase, winType: "tsumo", rinshan: true },
    },
    chankan: {
      menzen: { ...menzenBase, winType: "ron", chankan: true },
      open: { ...openBase, winType: "ron", chankan: true },
    },
    tanyao: {
      menzen: {
        concealedTiles: parseTiles("234p 567p 234s 678s 55p"),
        winningTile: parseTile("4p"),
        winType: "ron",
      },
    },
    pinfu: { menzen: { ...menzenBase, winType: "ron" } },
    iipeikou: {
      menzen: {
        concealedTiles: parseTiles("234p 234p 567s 789s 55p"),
        winningTile: parseTile("5s"),
        winType: "tsumo",
      },
    },
    ryanpeikou: {
      menzen: {
        concealedTiles: parseTiles("234p 234p 678s 678s 55p"),
        winningTile: parseTile("4p"),
        winType: "tsumo",
      },
    },
    yakuhai_dragon_5: {
      menzen: {
        concealedTiles: parseTiles("555z 234p 567p 234s 99p"),
        winningTile: parseTile("4p"),
        winType: "tsumo",
      },
      open: { ...openBase, winType: "ron" },
    },
    yakuhai_dragon_6: {
      menzen: {
        concealedTiles: parseTiles("666z 234p 567p 234s 99p"),
        winningTile: parseTile("4p"),
        winType: "tsumo",
      },
      open: {
        concealedTiles: parseTiles("234p 567p 678p 55p"),
        melds: [pon("666z")],
        winningTile: parseTile("2p"),
        winType: "ron",
      },
    },
    yakuhai_dragon_7: {
      menzen: {
        concealedTiles: parseTiles("777z 234p 567p 234s 99p"),
        winningTile: parseTile("4p"),
        winType: "tsumo",
      },
      open: {
        concealedTiles: parseTiles("234p 567p 678p 55p"),
        melds: [pon("777z")],
        winningTile: parseTile("2p"),
        winType: "ron",
      },
    },
    yakuhai_round_wind: {
      menzen: {
        concealedTiles: parseTiles("111z 234p 567p 234s 99p"),
        winningTile: parseTile("4p"),
        winType: "tsumo",
        roundWind: HONOR.EAST,
      },
      open: {
        concealedTiles: parseTiles("234p 567p 678p 55p"),
        melds: [pon("111z")],
        winningTile: parseTile("2p"),
        winType: "ron",
        roundWind: HONOR.EAST,
      },
    },
    yakuhai_seat_wind: {
      menzen: {
        concealedTiles: parseTiles("111z 234p 567p 234s 99p"),
        winningTile: parseTile("4p"),
        winType: "tsumo",
        seatWind: HONOR.EAST,
      },
      open: {
        concealedTiles: parseTiles("234p 567p 678p 55p"),
        melds: [pon("111z")],
        winningTile: parseTile("2p"),
        winType: "ron",
        seatWind: HONOR.EAST,
      },
    },
    sanshoku_doukou: {
      menzen: {
        concealedTiles: parseTiles("111m 111p 111s 234p 99p"),
        winningTile: parseTile("2p"),
        winType: "tsumo",
      },
      open: {
        concealedTiles: parseTiles("111p 111s 234p 99p"),
        melds: [pon("111m")],
        winningTile: parseTile("2p"),
        winType: "ron",
      },
    },
    ittsuu: {
      menzen: {
        concealedTiles: parseTiles("123p 456p 789p 234s 55s"),
        winningTile: parseTile("9p"),
        winType: "tsumo",
      },
      open: {
        concealedTiles: parseTiles("123p 456p 789p 55s"),
        melds: [pon("222s")],
        winningTile: parseTile("9p"),
        winType: "ron",
      },
    },
    toitoi: {
      menzen: {
        concealedTiles: parseTiles("111p 333p 555s 777s 99p"),
        winningTile: parseTile("1p"),
        winType: "ron",
      },
      open: {
        concealedTiles: parseTiles("333p 555s 777s 99p"),
        melds: [pon("111p")],
        winningTile: parseTile("3p"),
        winType: "ron",
      },
    },
    sanankou: {
      menzen: {
        concealedTiles: parseTiles("111p 333p 555s 234s 99p"),
        winningTile: parseTile("2s"),
        winType: "tsumo",
      },
      open: {
        concealedTiles: parseTiles("111p 333p 555s 99s"),
        melds: [pon("999p")],
        winningTile: parseTile("9s"),
        winType: "tsumo",
      },
    },
    sankantsu: {
      menzen: {
        concealedTiles: parseTiles("234s 99s"),
        melds: [closedKan("1111p"), closedKan("9999p"), closedKan("1111s")],
        winningTile: parseTile("2s"),
        winType: "tsumo",
      },
      open: {
        concealedTiles: parseTiles("234s 99s"),
        melds: [openKan("1111p"), openKan("9999p"), openKan("1111s")],
        winningTile: parseTile("2s"),
        winType: "ron",
      },
    },
    shousangen: {
      menzen: {
        concealedTiles: parseTiles("555z 666z 234p 234s 77z"),
        winningTile: parseTile("2p"),
        winType: "tsumo",
      },
      open: {
        concealedTiles: parseTiles("666z 234p 234s 77z"),
        melds: [pon("555z")],
        winningTile: parseTile("2p"),
        winType: "ron",
      },
    },
    chanta: {
      menzen: {
        concealedTiles: parseTiles("123p 789p 123s 111z 99s"),
        winningTile: parseTile("3p"),
        winType: "tsumo",
      },
      open: {
        concealedTiles: parseTiles("123p 789p 123s 99s"),
        melds: [pon("111z")],
        winningTile: parseTile("3p"),
        winType: "ron",
      },
    },
    junchan: {
      menzen: {
        concealedTiles: parseTiles("123p 789p 123s 789s 99p"),
        winningTile: parseTile("3p"),
        winType: "tsumo",
      },
      open: {
        concealedTiles: parseTiles("789p 123s 789s 99p"),
        melds: [pon("111p")],
        winningTile: parseTile("3s"),
        winType: "ron",
      },
    },
    honroutou: {
      menzen: {
        concealedTiles: parseTiles("111z 222z 333z 999p 99m"),
        winningTile: parseTile("9p"),
        winType: "ron",
      },
      open: {
        concealedTiles: parseTiles("222z 333z 999p 99m"),
        melds: [pon("111z")],
        winningTile: parseTile("9p"),
        winType: "ron",
      },
    },
    honitsu: {
      menzen: {
        concealedTiles: parseTiles("123p 456p 789p 111z 99p"),
        winningTile: parseTile("3p"),
        winType: "tsumo",
      },
      open: {
        concealedTiles: parseTiles("123p 456p 789p 99p"),
        melds: [pon("111z")],
        winningTile: parseTile("3p"),
        winType: "ron",
      },
    },
    chinitsu: {
      menzen: {
        concealedTiles: parseTiles("123p 456p 789p 234p 99p"),
        winningTile: parseTile("3p"),
        winType: "tsumo",
      },
      open: {
        concealedTiles: parseTiles("123p 456p 789p 99p"),
        melds: [pon("222p")],
        winningTile: parseTile("3p"),
        winType: "ron",
      },
    },
    chiitoitsu: {
      menzen: {
        concealedTiles: parseTiles("11p 33p 55p 77p 99p 22s 44s"),
        winningTile: parseTile("4s"),
        winType: "tsumo",
      },
    },
  };

/**
 * 表の「—」(副露で無効)を**振る舞いとして**固定するための副露手フィクスチャ。
 * いずれも「門前ガードを外せばその役が付く」形になっており、ガードの撤去を検出する。
 */
const OPEN_INVALID = {
  riichi: { ...openBase, winType: "ron", riichi: true },
  double_riichi: { ...openBase, winType: "ron", doubleRiichi: true },
  ippatsu: { ...openBase, winType: "ron", riichi: true, ippatsu: true },
  menzen_tsumo: { ...openBase, winType: "tsumo" },
  tanyao: {
    concealedTiles: parseTiles("234p 567p 678p 55p"),
    melds: [pon("333s")],
    winningTile: parseTile("2p"),
    winType: "ron",
  },
  iipeikou: {
    concealedTiles: parseTiles("234p 234p 567p 55p"),
    melds: [pon("555z")],
    winningTile: parseTile("2p"),
    winType: "ron",
  },
} as const satisfies Partial<Record<SpecYakuId, WinContext>>;

/**
 * 副露手フィクスチャが**構造的に作れない**「—」の役。
 * サンマにはチーが無く副露は必ず刻子・槓子になるため、4 面子すべてが順子である必要の
 * ある平和・二盃口と、7 対子である七対子は副露手として存在し得ない。
 */
const STRUCTURALLY_MENZEN_ONLY: readonly SpecYakuId[] = [
  "pinfu",
  "ryanpeikou",
  "chiitoitsu",
];

describe("spec 3.0 役表の翻を固定する (#391)", () => {
  const entries = Object.keys(SPEC_HAN) as SpecYakuId[];

  it.each(entries)("%s: 門前の翻が spec 3.0 と一致する", (id) => {
    const analysis = analyzeWin(FIXTURES[id].menzen);
    const yaku = analysis?.yaku.find((y) => y.id === id);
    expect(yaku, `${id} が門前フィクスチャで成立していない`).toBeDefined();
    expect(yaku?.han).toBe(SPEC_HAN[id].menzen);
  });

  const openEntries = entries.filter((id) => SPEC_HAN[id].open !== null);

  it.each(openEntries)(
    "%s: 副露の翻(喰い下がり)が spec 3.0 と一致する",
    (id) => {
      const fixture = FIXTURES[id].open;
      if (!fixture) throw new Error(`${id} の副露フィクスチャが未定義`);
      const analysis = analyzeWin(fixture);
      const yaku = analysis?.yaku.find((y) => y.id === id);
      expect(yaku, `${id} が副露フィクスチャで成立していない`).toBeDefined();
      expect(yaku?.han).toBe(SPEC_HAN[id].open);
    },
  );

  /**
   * 表の「—」は「副露(ポン・カン)で無効化される」という**振る舞いの規定**なので、
   * 「副露フィクスチャを置いていないこと」を確認しても何も守れない(恒真になる)。
   * 実際に副露手を組み、その役が**付かない**ことを見る。
   */
  it.each(Object.keys(OPEN_INVALID) as (keyof typeof OPEN_INVALID)[])(
    "%s: 副露手では成立しない(spec 3.0 表の「—」)",
    (id) => {
      const got = analyzeWin(OPEN_INVALID[id])?.yaku.map((y) => y.id) ?? [];
      expect(got).not.toContain(id);
    },
  );

  /**
   * 「—」の役のうち、副露手フィクスチャを作れないものは構造的な理由を明示して除外する。
   * サンマにはチーが無く**副露は必ず刻子・槓子**になるため、4 面子すべてが順子である
   * 必要のある平和・二盃口と、7 対子である七対子は副露手として存在し得ない。
   * この集合を明示的に固定することで、「単に書き忘れた」役が黙って漏れるのを防ぐ。
   */
  it("「—」の役は副露否定テストか構造的除外のどちらかで説明されている", () => {
    const menzenOnly = entries.filter((id) => SPEC_HAN[id].open === null);
    const explained = new Set<string>([
      ...Object.keys(OPEN_INVALID),
      ...STRUCTURALLY_MENZEN_ONLY,
    ]);
    expect(menzenOnly.filter((id) => !explained.has(id))).toEqual([]);
  });
});

/**
 * spec 3.0「役満(一律シングル = `yakuman: 1`)」表の固定(#391)。
 *
 * spec 3.0 は「国士十三面・四暗刻単騎・大四喜・純正九蓮宝燈のダブル役満は**採用しない**
 * (一律シングル)」と規定するが、既存テストは `isYakuman === true` と id の包含しか
 * 見ておらず、**`yakuman === 1` を固定していなかった**。
 *
 * ここでは各役満役オブジェクトの `yakuman` を直接見る(手の合計ではないので、
 * 天和・地和との複合フィクスチャでも 1 役あたりの倍数を正しく主張できる)。
 */
const YAKUMAN_FIXTURES: [id: string, ctx: WinContext][] = [
  [
    "tenhou",
    {
      concealedTiles: parseTiles("234p 567p 234s 678s 99p"),
      winningTile: parseTile("4p"),
      winType: "tsumo",
      blessing: "heaven",
    },
  ],
  [
    "chiihou",
    {
      concealedTiles: parseTiles("234p 567p 234s 678s 99p"),
      winningTile: parseTile("4p"),
      winType: "tsumo",
      blessing: "earth",
    },
  ],
  [
    "kokushi",
    {
      concealedTiles: parseTiles("119m 19p 19s 1234567z"),
      winningTile: parseTile("1m"),
      winType: "tsumo",
    },
  ],
  [
    "tsuuiisou",
    {
      concealedTiles: parseTiles("111z 222z 333z 555z 66z"),
      winningTile: parseTile("6z"),
      winType: "tsumo",
    },
  ],
  [
    "chinroutou",
    {
      concealedTiles: parseTiles("111m 999m 111p 999p 99s"),
      winningTile: parseTile("9s"),
      winType: "tsumo",
    },
  ],
  [
    "ryuuiisou",
    {
      concealedTiles: parseTiles("234s 234s 666s 888s 66z"),
      winningTile: parseTile("6z"),
      winType: "tsumo",
    },
  ],
  [
    "daisangen",
    {
      concealedTiles: parseTiles("555z 666z 777z 111p 99p"),
      winningTile: parseTile("9p"),
      winType: "tsumo",
    },
  ],
  [
    "shousuushii",
    {
      concealedTiles: parseTiles("111z 222z 333z 44z 999p"),
      winningTile: parseTile("9p"),
      winType: "tsumo",
    },
  ],
  [
    "suukantsu",
    {
      concealedTiles: parseTiles("99s"),
      melds: [
        closedKan("1111p"),
        closedKan("9999p"),
        closedKan("1111s"),
        closedKan("2222s"),
      ],
      winningTile: parseTile("9s"),
      winType: "tsumo",
    },
  ],
];

/**
 * spec 3.0:96 が「ダブル役満は採用しない」と**名指しする 4 形**。
 * 国士十三面・四暗刻単騎・大四喜・純正九蓮宝燈。
 */
const SINGLE_YAKUMAN_NAMED: [label: string, id: string, ctx: WinContext][] = [
  [
    "国士無双十三面待ち",
    "kokushi",
    {
      concealedTiles: parseTiles("19m 19p 19s 1234567z 1m"),
      winningTile: parseTile("1m"),
      winType: "ron",
    },
  ],
  [
    "四暗刻単騎",
    "suuankou",
    {
      concealedTiles: parseTiles("111p 333p 555s 777s 99p"),
      winningTile: parseTile("9p"),
      winType: "ron",
    },
  ],
  [
    // ツモだと 4 暗刻が揃って四暗刻と複合し、手の合計が 2 になる(役満どうしの複合であり
    // 「大四喜そのものがダブル」ではない)。ここでは大四喜単独を見たいのでロンで和了し、
    // 和了牌が完成させた刻子を明刻へ降格させて四暗刻を外す。
    "大四喜",
    "daisuushii",
    {
      concealedTiles: parseTiles("111z 222z 333z 444z 99p"),
      winningTile: parseTile("1z"),
      winType: "ron",
    },
  ],
  [
    "純正九蓮宝燈",
    "chuuren",
    {
      concealedTiles: parseTiles("11123456789999p"),
      winningTile: parseTile("9p"),
      winType: "tsumo",
    },
  ],
];

/** spec 3.0「役満(一律シングル)」表の id(12 種)。 */
const SPEC_YAKUMAN_IDS = [
  "tenhou",
  "chiihou",
  "kokushi",
  "tsuuiisou",
  "chinroutou",
  "ryuuiisou",
  "daisangen",
  "daisuushii",
  "shousuushii",
  "suuankou",
  "suukantsu",
  "chuuren",
] as const;

describe("spec 3.0 役満は一律シングル (#391)", () => {
  // 12 種の網羅が 2 つのテーブルの和集合に暗黙依存すると、片方からエントリが
  // 消えても緑のままになる。spec の id 一覧を独立に置いて突き合わせる。
  it("spec 3.0 の役満 12 種すべてに yakuman=1 のフィクスチャがある", () => {
    const covered = new Set<string>([
      ...YAKUMAN_FIXTURES.map(([id]) => id),
      ...SINGLE_YAKUMAN_NAMED.map(([, id]) => id),
    ]);
    expect(SPEC_YAKUMAN_IDS.filter((id) => !covered.has(id))).toEqual([]);
  });

  it.each(YAKUMAN_FIXTURES)("%s の yakuman は 1", (id, ctx) => {
    const analysis = analyzeWin(ctx);
    const yaku = analysis?.yaku.find((y) => y.id === id);
    expect(yaku, `${id} が成立していない`).toBeDefined();
    expect(yaku?.yakuman).toBe(1);
  });

  it.each(SINGLE_YAKUMAN_NAMED)(
    "%s もシングル(spec 3.0 がダブル役満を採用しないと名指しする形)",
    (_label, id, ctx) => {
      const analysis = analyzeWin(ctx);
      const yaku = analysis?.yaku.find((y) => y.id === id);
      expect(yaku, `${id} が成立していない`).toBeDefined();
      expect(yaku?.yakuman).toBe(1);
      expect(analysis?.yakuman).toBe(1);
    },
  );
});
