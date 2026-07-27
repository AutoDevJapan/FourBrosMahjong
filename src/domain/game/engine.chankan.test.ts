import { describe, expect, it } from "vitest";
import type { Meld } from "@/domain/hand/meld";
import { parseTile, parseTiles } from "@/domain/hand/notation";
import { analyzeWin } from "@/domain/hand/win";
import { HONOR } from "@/domain/tiles/tile";
import {
  createGame,
  declareKakan,
  type EngineState,
  type SeatKey,
} from "./engine";

/**
 * 槍槓(チャンカン / Q17 = 槍槓あり・#115)の結線テスト。
 *
 * `declareKakan`(自家 p0 = 東/親 の加槓)に対し、他家(AI)がその加槓牌で
 * ロンできれば加槓を取り消して槍槓ロンを成立させる挙動を検証する。
 *
 * ## 検証の要
 * 応答者(南/西)の手牌は **`chankan`(1翻)以外に役が付かない形**(么九混在で断么九なし・
 * カンチャン待ちで平和なし・役牌/三色/一盃口/一気通貫/チャンタ いずれも不成立)に固定する。
 * したがって「和了が成立した」こと自体が、engine が `chankan` 役を付与している証拠になる
 * (下の `analyzeWin` 直接検証で、この形が chankan なしでは役なし=null であることを固定する)。
 *
 * `HandState` は engine 内部型のため、`createGame` で得た初期局面の可変フィールド
 * (hands / melds / discards / turn / drawn)を直接上書きして局面を組み立てる。
 */

/** 槍槓応答者(南・西)に据える「chankan 以外は役なし」の 3p カンチャン待ち手牌(13枚)。 */
const CHANKAN_WAIT_3P = "2p 4p 123s 789s 678p 99p";
/** 加槓牌(3p)。赤5を避けるため 3p を採用(5p/5s は常に赤=ドラのため)。 */
const KAKAN_KIND = "3p";

/** p0(東/親)に「3p のポン + 手に4枚目の 3p」を仕込み、加槓宣言待ちにした局面を作る。 */
function armKakan(seed: number): {
  state: EngineState;
  kakanTile: ReturnType<typeof parseTile>;
} {
  const s = createGame({ seed });
  const hand = s.hand;
  if (hand === null)
    throw new Error("hand should exist right after createGame");

  const pon3p: Meld = {
    type: "pon",
    tiles: parseTiles("3p 3p 3p"),
    concealed: false,
  };
  hand.melds.east = [pon3p];
  // pool(= hands + drawn)に加槓する4枚目の 3p を含める。残りは任意。
  hand.hands.east = parseTiles("3p 1m 9m 1s 9s");
  hand.drawn = parseTile("9m");
  hand.turn = "east";

  const kakanTile = parseTile(KAKAN_KIND);
  return {
    state: {
      ...s,
      pending: {
        kind: "humanDiscard",
        canTsumo: false,
        canRiichi: false,
        riichiTiles: [],
        ankanTiles: [],
        kakanTiles: [kakanTile],
        forbiddenDiscards: [],
        locked: false,
      },
    },
    kakanTile,
  };
}

/** 指定席にテンパイ/フリテン等を仕込むヘルパ。 */
function seatWaits(
  state: EngineState,
  seat: SeatKey,
  notation: string,
  discards: string[] = [],
): void {
  const hand = state.hand;
  if (hand === null) throw new Error("no hand");
  hand.hands[seat] = parseTiles(notation);
  hand.melds[seat] = [];
  const river = discards.flatMap((d) => parseTiles(d));
  hand.discards[seat] = river;
  // 捨て牌フリテンの判定は打牌履歴側を見る(#395)。河と同じ内容で揃える。
  hand.discardHistory[seat] = [...river];
}

describe("engine: 槍槓(チャンカン / Q17・#115)", () => {
  it("待ち手牌は chankan 以外に役が付かない(フィクスチャの前提固定)", () => {
    const winTile = parseTile(KAKAN_KIND);
    const base = {
      concealedTiles: [...parseTiles(CHANKAN_WAIT_3P), winTile],
      winningTile: winTile,
      winType: "ron" as const,
      seatWind: HONOR.SOUTH,
      roundWind: HONOR.EAST,
    };
    // chankan なし: 役なし → null(= この形の唯一の役は槍槓である)。
    expect(analyzeWin(base)).toBeNull();
    // chankan あり: 和了成立。
    expect(analyzeWin({ ...base, chankan: true })).not.toBeNull();
  });

  it("加槓牌で他家がロンできると槍槓ロンが成立し、加槓は取り消される", () => {
    const { state, kakanTile } = armKakan(1);
    seatWaits(state, "south", CHANKAN_WAIT_3P); // 南(p1)がテンパイ
    seatWaits(state, "west", "1p 1p 1p 9p 9p 9p 1s 1s 1s 9s 9s 5s 5s"); // 西は非テンパイ

    const after = declareKakan(state, kakanTile);

    expect(after.phase).toBe("roundEnd");
    expect(after.lastRound?.kind).toBe("win");
    expect(after.lastRound?.winnerId).toBe("p1");
    // 加槓は不成立=牌は手に戻らず横取り。ポンは槓に昇格していない(取り消し)。
    expect(after.hand?.melds.east[0].type).toBe("pon");
    // 加槓者(p0=親)が放銃者として支払い、和了者(p1)が受け取る。
    expect(after.lastRound?.deltas.p0).toBeLessThan(0);
    expect(after.lastRound?.deltas.p1).toBeGreaterThan(0);
  });

  it("複数家がロン可能なら頭ハネ(上家取り・通常ロンと同順)で最先の1人のみ和了", () => {
    const { state, kakanTile } = armKakan(2);
    // 南(p1)・西(p2)ともに 3p でロン可能 → ronOrder(east)=[south, west] で南が優先。
    seatWaits(state, "south", CHANKAN_WAIT_3P);
    seatWaits(state, "west", CHANKAN_WAIT_3P);

    const after = declareKakan(state, kakanTile);

    expect(after.phase).toBe("roundEnd");
    expect(after.lastRound?.winnerId).toBe("p1");
  });

  it("加槓牌が他家のフリテン牌なら槍槓は成立せず、加槓続行で嶺上ツモへ進む", () => {
    const { state, kakanTile } = armKakan(3);
    // 南は 3p 待ちだが自河に 3p =フリテン → ロン不可。西は非テンパイ。
    seatWaits(state, "south", CHANKAN_WAIT_3P, [KAKAN_KIND]);
    seatWaits(state, "west", "1p 1p 1p 9p 9p 9p 1s 1s 1s 9s 9s 5s 5s");

    const after = declareKakan(state, kakanTile);

    // 誰も横取りできない → 加槓成立(ポン→槓に昇格)、嶺上補充、局は継続。
    expect(after.phase).toBe("playing");
    expect(after.hand?.melds.east[0].type).toBe("kan");
    expect(after.hand?.drawn).not.toBeNull(); // 嶺上ツモ済み
    expect(after.pending?.kind).toBe("humanDiscard");
    expect(after.lastRound).toBeNull(); // 和了なし
  });

  it("誰も加槓牌でロンできないなら加槓成立で嶺上へ進む", () => {
    const { state, kakanTile } = armKakan(4);
    seatWaits(state, "south", "1p 1p 1p 9p 9p 9p 1s 1s 1s 9s 9s 5s 5s");
    seatWaits(state, "west", "1p 1p 1p 9p 9p 9p 1s 1s 1s 9s 9s 5s 5s");

    const after = declareKakan(state, kakanTile);

    expect(after.phase).toBe("playing");
    expect(after.hand?.melds.east[0].type).toBe("kan");
    expect(after.lastRound).toBeNull();
  });
});
