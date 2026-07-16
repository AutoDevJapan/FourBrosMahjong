/**
 * 結合テスト②「配牌 → 和了判定」(issue #90 / spec game-flow 2.4)。
 *
 * 決定的 seed で配った手 + 追加ツモに対し、和了系モジュール
 * (decompose / tenpai / furiten / win)が矛盾なく結線されることを固める:
 *   - `analyzeWin` は任意の実配牌に対して例外を投げず、
 *     `isWinningHand(ctx) === (analyzeWin(ctx) !== null)` が常に成立
 *   - `tenpai.waitingTiles` と `decompose.isCompleteHand` が整合
 *     (待ち牌を足せば必ず和了形・待ちでない牌は非和了形)
 *   - テンパイ手に待ち牌をツモると和了(役あり)/ 非和了手は null
 *
 * scoring(#66)には非依存。決定的。
 */

import { describe, expect, it } from "vitest";
import { dealStartingHands } from "../deal/deal";
import { isCompleteHand } from "../hand/decompose";
import { parseTile, parseTiles } from "../hand/notation";
import { isTenpai, waitingTiles } from "../hand/tenpai";
import { SANMA_TILE_KINDS, sameKind } from "../hand/tile-identity";
import { analyzeWin, isWinningHand, type WinContext } from "../hand/win";
import { createSeededRng } from "../random/rng";
import type { Suit, Tile } from "../tiles/tile";
import { buildWall } from "../wall/wall";

const RED_FIVE_SUITS: ReadonlySet<Suit> = new Set(["pin", "sou"]);
function makeTile(suit: Suit, rank: number): Tile {
  return { suit, rank, isRed: rank === 5 && RED_FIVE_SUITS.has(suit) };
}

/** 手牌中の牌種(赤無視)ごとの枚数。 */
function kindCounts(tiles: readonly Tile[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tiles) {
    const key = `${t.suit}-${t.rank}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

const SEEDS = [1, 7, 42, 2718, 99999] as const;

describe("結合②: 配牌 → 和了判定(deal → tenpai/decompose/win)", () => {
  it.each(SEEDS)(
    "実配牌+追加ツモ(seed=%i)で analyzeWin は例外を投げず isWinningHand と整合",
    (seed) => {
      const wall = buildWall(createSeededRng(seed));
      const hands = dealStartingHands(wall);

      for (const hand of hands) {
        // 13枚 + 追加ツモ1枚 = 14枚。ツモ牌を和了牌として文脈化。
        const drawn = wall.draw();
        const concealed = [...hand, drawn];
        const ctx: WinContext = {
          concealedTiles: concealed,
          winningTile: drawn,
          winType: "tsumo",
        };
        // 契約: 例外なし・分析結果と真偽判定が一致。
        const analysis = analyzeWin(ctx);
        expect(isWinningHand(ctx)).toBe(analysis !== null);
        if (analysis) {
          expect(analysis.han).toBeGreaterThanOrEqual(0);
          expect(analysis.yaku.length).toBeGreaterThan(0);
        }
      }
    },
  );

  it.each(SEEDS)(
    "実配牌(seed=%i)で waitingTiles と isCompleteHand が整合する",
    (seed) => {
      const wall = buildWall(createSeededRng(seed));
      const hands = dealStartingHands(wall);

      for (const hand of hands) {
        const waits = waitingTiles(hand, []);
        // isTenpai は待ちの有無と一致。
        expect(isTenpai(hand, [])).toBe(waits.length > 0);

        const waitKeys = new Set(waits.map((w) => `${w.suit}-${w.rank}`));
        const used = kindCounts(hand);

        for (const kind of SANMA_TILE_KINDS) {
          const key = `${kind.suit}-${kind.rank}`;
          if ((used.get(key) ?? 0) >= 4) continue; // 4枚使用済みは追加不可
          const candidate = makeTile(kind.suit, kind.rank);
          const complete = isCompleteHand([...hand, candidate], []);
          // 契約: 「待ち」⇔「その牌を足すと和了形」。
          expect(complete).toBe(waitKeys.has(key));
        }
      }
    },
  );

  it("テンパイ手に待ち牌をツモると和了(役あり)になる(門前ツモ)", () => {
    // 4順子完成 + 9p 単騎待ち(配牌→ツモで到達し得る典型テンパイ)。
    const tenpai = parseTiles("234p 567p 234s 678s 9p"); // 13枚
    const waits = waitingTiles(tenpai, []);
    expect(waits).toHaveLength(1);
    expect(sameKind(waits[0], parseTile("9p"))).toBe(true);

    const winning = parseTile("9p");
    const analysis = analyzeWin({
      concealedTiles: [...tenpai, winning], // 14枚
      winningTile: winning,
      winType: "tsumo",
    });
    expect(analysis).not.toBeNull();
    expect(analysis?.yaku.map((y) => y.id)).toContain("menzen_tsumo");
  });

  it("和了形でない手は analyzeWin=null / isWinningHand=false", () => {
    const ctx: WinContext = {
      concealedTiles: parseTiles("123p 456p 789p 135s 99s"), // 14枚・非和了形
      winningTile: parseTile("1s"),
      winType: "ron",
    };
    expect(analyzeWin(ctx)).toBeNull();
    expect(isWinningHand(ctx)).toBe(false);
  });
});
