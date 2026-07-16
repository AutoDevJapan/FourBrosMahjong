import { describe, expect, it } from "vitest";
import { canRon, canTsumo, evaluateFuriten } from "./furiten";
import { parseTile, parseTiles } from "./notation";

// 2345s 待ち(2s/5s)を持つテンパイ手。
const TENPAI = parseTiles("123p 456p 789p 2345s");

describe("evaluateFuriten", () => {
  it("待ち牌が自河にあれば捨て牌フリテン", () => {
    const result = evaluateFuriten({
      concealedTiles: TENPAI,
      ownDiscards: parseTiles("5s"),
    });
    expect(result.furiten).toBe(true);
    expect(result.reason).toBe("discard");
  });

  it("待ちと無関係な捨て牌ではフリテンにならない", () => {
    const result = evaluateFuriten({
      concealedTiles: TENPAI,
      ownDiscards: parseTiles("1p 9p"),
    });
    expect(result.furiten).toBe(false);
  });

  it("同巡内見逃し・リーチ後見逃しは文脈でフリテン", () => {
    expect(
      evaluateFuriten({
        concealedTiles: TENPAI,
        ownDiscards: [],
        temporaryMiss: true,
      }).reason,
    ).toBe("temporary");
    expect(
      evaluateFuriten({
        concealedTiles: TENPAI,
        ownDiscards: [],
        riichiMiss: true,
      }).reason,
    ).toBe("riichi");
  });
});

describe("canRon / canTsumo(spec 2.4 受け入れ基準)", () => {
  it("フリテンではロン不可・ツモ可(見逃し扱い)", () => {
    const ctx = { concealedTiles: TENPAI, ownDiscards: parseTiles("2s") };
    expect(canRon(ctx, parseTile("5s"))).toBe(false);
    expect(canTsumo(ctx, parseTile("5s"))).toBe(true);
  });

  it("非フリテンなら当たり牌でロン可", () => {
    const ctx = { concealedTiles: TENPAI, ownDiscards: parseTiles("1m") };
    expect(canRon(ctx, parseTile("2s"))).toBe(true);
    expect(canRon(ctx, parseTile("5s"))).toBe(true);
  });

  it("待ち牌でない牌ではロンもツモも不可", () => {
    const ctx = { concealedTiles: TENPAI, ownDiscards: [] };
    expect(canRon(ctx, parseTile("3s"))).toBe(false);
    expect(canTsumo(ctx, parseTile("3s"))).toBe(false);
  });
});
