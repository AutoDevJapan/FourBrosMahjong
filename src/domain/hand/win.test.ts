import { describe, expect, it } from "vitest";
import { HONOR } from "../tiles/tile";
import type { Meld, MeldType } from "./meld";
import { parseTile, parseTiles } from "./notation";
import { type WinContext, analyzeWin, isWinningHand } from "./win";

function ids(ctx: WinContext): string[] {
  const analysis = analyzeWin(ctx);
  return analysis ? analysis.yaku.map((y) => y.id).sort() : [];
}

const PON_TYPE: MeldType = "pon";
const pon = (notation: string): Meld => ({
  type: PON_TYPE,
  tiles: parseTiles(notation),
  concealed: false,
});

describe("和了形の判定", () => {
  it("和了形でない手は null / isWinningHand=false", () => {
    const ctx: WinContext = {
      concealedTiles: parseTiles("123p 456p 789p 135s 99s"),
      winningTile: parseTile("1s"),
      winType: "ron",
    };
    expect(analyzeWin(ctx)).toBeNull();
    expect(isWinningHand(ctx)).toBe(false);
  });

  it("役ありの和了は isWinningHand=true", () => {
    expect(
      isWinningHand({
        concealedTiles: parseTiles("234p 567p 234s 678s 99p"),
        winningTile: parseTile("4p"),
        winType: "ron",
      }),
    ).toBe(true);
  });

  it("和了形だが役が無い手は null(ドラ・役牌なし)", () => {
    // 副露あり(非門前)・么九混在で断么九/役牌/チャンタ いずれも不成立。
    expect(
      analyzeWin({
        concealedTiles: parseTiles("123p 456s 789s 99m"),
        melds: [pon("999p")],
        winningTile: parseTile("1p"),
        winType: "ron",
      }),
    ).toBeNull();
  });
});

describe("通常役の判定", () => {
  it("平和(門前・全順子・両面・役なし雀頭)", () => {
    const ctx: WinContext = {
      concealedTiles: parseTiles("234p 567p 234s 678s 99p"),
      winningTile: parseTile("4p"),
      winType: "ron",
    };
    expect(ids(ctx)).toContain("pinfu");
    expect(analyzeWin(ctx)?.han).toBe(1);
  });

  it("門前ツモ+断么九(全て2〜8)", () => {
    const ctx: WinContext = {
      concealedTiles: parseTiles("234p 567p 222s 678s 55p"),
      winningTile: parseTile("6p"),
      winType: "tsumo",
    };
    const got = ids(ctx);
    expect(got).toContain("tanyao");
    expect(got).toContain("menzen_tsumo");
  });

  it("役牌(三元牌 白)は暗刻で成立", () => {
    const ctx: WinContext = {
      concealedTiles: parseTiles("555z 234p 567s 678s 99p"),
      winningTile: parseTile("9p"),
      winType: "ron",
    };
    expect(ids(ctx)).toContain("yakuhai_dragon_5");
  });

  it("混一色は門前3翻・副露2翻(喰い下がり)", () => {
    const closed: WinContext = {
      concealedTiles: parseTiles("123p 789p 555z 66z 789p"),
      winningTile: parseTile("9p"),
      winType: "ron",
    };
    expect(analyzeWin(closed)?.yaku.find((y) => y.id === "honitsu")?.han).toBe(
      3,
    );

    const open: WinContext = {
      concealedTiles: parseTiles("123p 789p 789p 66z"),
      melds: [pon("555z")],
      winningTile: parseTile("9p"),
      winType: "ron",
    };
    // 白ポンが役牌なので後付けにならず、混一色は喰い下がり2翻。
    expect(analyzeWin(open)?.yaku.find((y) => y.id === "honitsu")?.han).toBe(2);
  });

  it("清一色(門前6翻)", () => {
    const ctx: WinContext = {
      concealedTiles: parseTiles("111p 234p 567p 789p 99p"),
      winningTile: parseTile("9p"),
      winType: "ron",
    };
    expect(analyzeWin(ctx)?.yaku.find((y) => y.id === "chinitsu")?.han).toBe(6);
  });

  it("混全帯么九(全グループに么九・順子あり)", () => {
    const ctx: WinContext = {
      concealedTiles: parseTiles("123p 789p 123s 111z 99s"),
      winningTile: parseTile("3p"),
      winType: "ron",
      roundWind: HONOR.EAST,
    };
    expect(ids(ctx)).toContain("chanta");
  });

  it("七対子(門前2翻)", () => {
    const ctx: WinContext = {
      concealedTiles: parseTiles("11p 33p 22s 44s 66s 88s 77z"),
      winningTile: parseTile("7z"),
      winType: "tsumo",
    };
    expect(ids(ctx)).toContain("chiitoitsu");
  });

  it("対々和+三暗刻(暗刻3+ポン1)", () => {
    // 777s はポン(明刻)、111p/333p/555s が暗刻3つ。
    const ctx: WinContext = {
      concealedTiles: parseTiles("111p 333p 555s 99p"),
      melds: [pon("777s")],
      winningTile: parseTile("9p"),
      winType: "tsumo",
    };
    const got = ids(ctx);
    expect(got).toContain("toitoi");
    expect(got).toContain("sanankou");
  });
});

describe("ナシナシ制約(spec 1.4)", () => {
  it("喰いタン無し: 副露の断么九のみは役なし(和了不可)", () => {
    const ctx: WinContext = {
      concealedTiles: parseTiles("234p 567p 678p 55p"),
      melds: [pon("222s")],
      winningTile: parseTile("4p"),
      winType: "ron",
    };
    expect(analyzeWin(ctx)).toBeNull();
  });

  it("後付け無し: 和了牌で完成した役牌だけの副露手は和了不可", () => {
    // 副露手・シャンポン待ちで白をロン完成 → 唯一の役が後付け役牌 → 無効。
    const ctx: WinContext = {
      concealedTiles: parseTiles("234p 567p 555z 99p"),
      melds: [pon("111s")],
      winningTile: parseTile("5z"),
      winType: "ron",
    };
    expect(analyzeWin(ctx)).toBeNull();
  });

  it("先付け: 役牌が和了前に確定済みなら和了可", () => {
    // 白暗刻は既に確定、和了牌9pは雀頭 → 後付けに当たらず有効。
    const ctx: WinContext = {
      concealedTiles: parseTiles("555z 234p 567p 99p"),
      melds: [pon("111s")],
      winningTile: parseTile("9p"),
      winType: "ron",
    };
    const analysis = analyzeWin(ctx);
    expect(analysis).not.toBeNull();
    expect(analysis?.yaku.map((y) => y.id)).toContain("yakuhai_dragon_5");
  });
});

describe("役満の判定", () => {
  it("四暗刻(門前・全暗刻ツモ)", () => {
    const analysis = analyzeWin({
      concealedTiles: parseTiles("111p 333p 555s 777s 99p"),
      winningTile: parseTile("9p"),
      winType: "tsumo",
    });
    expect(analysis?.isYakuman).toBe(true);
    expect(analysis?.yaku.map((y) => y.id)).toContain("suuankou");
  });

  it("大三元はパオ対象役満として検出される", () => {
    const analysis = analyzeWin({
      concealedTiles: parseTiles("555z 666z 777z 234p 99p"),
      winningTile: parseTile("2p"),
      winType: "tsumo",
    });
    expect(analysis?.isYakuman).toBe(true);
    expect(analysis?.pao).toContain("daisangen");
  });

  it("国士無双(役満)", () => {
    const analysis = analyzeWin({
      concealedTiles: parseTiles("19m 19p 19s 11234567z"),
      winningTile: parseTile("1z"),
      winType: "tsumo",
    });
    expect(analysis?.isYakuman).toBe(true);
    expect(analysis?.yaku.map((y) => y.id)).toContain("kokushi");
  });
});

describe("場風・自風の役牌(席は入力として受ける)", () => {
  it("場風=東・自風=東の東暗刻はダブ東で2翻", () => {
    const ctx: WinContext = {
      concealedTiles: parseTiles("111z 234p 567p 678s 99p"),
      winningTile: parseTile("9p"),
      winType: "ron",
      roundWind: HONOR.EAST,
      seatWind: HONOR.EAST,
    };
    const got = ids(ctx);
    expect(got).toContain("yakuhai_round_wind");
    expect(got).toContain("yakuhai_seat_wind");
  });

  it("風を指定しなければ風牌暗刻は役にならない", () => {
    const ctx: WinContext = {
      concealedTiles: parseTiles("111z 234p 567p 678s 99p"),
      winningTile: parseTile("9p"),
      winType: "ron",
    };
    expect(analyzeWin(ctx)).toBeNull();
  });
});
