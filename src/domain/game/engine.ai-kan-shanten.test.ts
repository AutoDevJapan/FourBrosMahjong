import { describe, expect, it } from "vitest";
import { shanten } from "@/domain/game/ai";
import { parseTile, parseTiles } from "@/domain/hand/notation";
import { sameKind } from "@/domain/hand/tile-identity";
import type { Tile } from "@/domain/tiles/tile";
import { createGame, discard, type EngineState, type SeatKey } from "./engine";

/**
 * AI のカン宣言が向聴を悪化させないこと(issue #304)。
 *
 * 従来は合法なら無条件に加槓→暗槓を宣言しており、順子・塔子に使っている牌を
 * 槓に回して自らテンパイを崩していた。本テストは
 *  - テンパイを崩す暗槓は**見送る**(手を維持する)
 *  - 向聴を悪化させない暗槓は**従来どおり宣言する**(過剰抑制していない)
 * ことを engine の公開 API 経由で検証する。
 *
 * フィクスチャは `engine.ai-chankan-choice.test.ts` と同じ方式で、`createGame` の
 * 初期局面の可変フィールドを上書きし、自家(東)の打牌で AI(南)の手番へ渡す。
 * 嶺上・ツモ牌の不確定性を排除するため、南が引く牌は `stackNextDraw` で固定する。
 */

/** 自家(東)用の散らばり13枚(和了・テンパイ・国士いずれも不成立)。 */
const EAST_JUNK_13 = "1m 9m 2p 5p 8p 3s 6s 9s 1z 2z 3z 5z 6z";

/** 席の手牌・副露・河を上書きする。 */
function setSeat(state: EngineState, seat: SeatKey, hand: string): void {
  const h = state.hand;
  if (h === null) throw new Error("no hand");
  h.hands[seat] = parseTiles(hand);
  h.melds[seat] = [];
  h.discards[seat] = [];
}

/**
 * 次に引かれる牌を固定する。ライブ壁から該当種別を先頭へ移動するだけなので、
 * 山の多重集合は変化しない(牌を増減させない)。
 */
function stackNextDraw(state: EngineState, notation: string): void {
  const h = state.hand;
  if (h === null) throw new Error("no hand");
  const want = parseTile(notation);
  const live = h.wall.liveWall as Tile[];
  const index = live.findIndex((t) => sameKind(t, want));
  if (index < 0) throw new Error(`live wall has no ${notation}`);
  const [tile] = live.splice(index, 1);
  live.unshift(tile);
}

/** 自家(東)の打牌待ち局面を作る。打牌すると南(AI)の手番になる。 */
function armEastTurn(seed: number, drawnTile: string): EngineState {
  const s = createGame({ seed });
  const hand = s.hand;
  if (hand === null) throw new Error("no hand");
  hand.hands.east = parseTiles(EAST_JUNK_13);
  hand.melds.east = [];
  hand.discards.east = [];
  hand.drawn = parseTile(drawnTile);
  hand.turn = "east";
  return {
    ...s,
    pending: {
      kind: "humanDiscard",
      canTsumo: false,
      canRiichi: false,
      riichiTiles: [],
      ankanTiles: [],
      kakanTiles: [],
      forbiddenDiscards: [],
      locked: false,
    },
  };
}

describe("engine: 向聴を悪化させるカンは宣言しない(#304)", () => {
  it("順子に使っている牌の暗槓でテンパイが崩れる場合は暗槓を見送る", () => {
    // 南: 5s×4 + 4s 6s + 123p + 456p + 9m(13枚)。3z を引いて14枚。
    //   カンしない: 123p / 456p / 456s / 555s の4面子 + 9m・3z → 単騎テンパイ(0向聴)。
    //   5s を暗槓: 4s 6s が孤立し 123p / 456p / 槓 の3面子 + 嵌張のみ → 1向聴へ悪化。
    const state = armEastTurn(1, "1z");
    setSeat(state, "south", "5s 5s 5s 5s 4s 6s 123p 456p 9m");
    stackNextDraw(state, "3z");

    const after = discard(state, parseTile("1z"));

    const hand = after.hand;
    if (hand === null) throw new Error("hand should exist");
    // 暗槓していない。
    expect(hand.melds.south).toHaveLength(0);
    // テンパイを維持したまま打牌している(13枚・0向聴)。
    expect(hand.hands.south).toHaveLength(13);
    expect(shanten(hand.hands.south, 0)).toBe(0);
  });

  it("向聴を悪化させない暗槓は従来どおり宣言する(過剰抑制しない)", () => {
    // 南: 1m×4 + 塔子2つ(23s / 56s)+ 孤立牌。1m は独立した暗刻+浮き牌なので、
    // 暗槓しても標準形の向聴は変わらない(4向聴のまま)。
    const state = armEastTurn(1, "1z");
    setSeat(state, "south", "1m 1m 1m 1m 2s 3s 5s 6s 9p 2z 3z 5z");
    stackNextDraw(state, "7z");

    const after = discard(state, parseTile("1z"));

    const hand = after.hand;
    if (hand === null) throw new Error("hand should exist");
    expect(hand.melds.south).toHaveLength(1);
    expect(hand.melds.south[0].type).toBe("kan");
    expect(hand.melds.south[0].concealed).toBe(true);
    expect(hand.melds.south[0].tiles).toHaveLength(4);
  });
});
