import { describe, expect, it } from "vitest";
import { parseTile, parseTiles } from "@/domain/hand/notation";
import { analyzeWin } from "@/domain/hand/win";
import { HONOR } from "@/domain/tiles/tile";
import {
  createGame,
  declareAnkan,
  type EngineState,
  type SeatKey,
} from "./engine";

/**
 * 国士無双の暗槓槍槓(Q17 フォローアップ / #126・ユーザー承認・国士のみ暗槓槍槓可)。
 *
 * 通常の槍槓(#115)は加槓のみが対象だが、**国士無双テンパイの他家に限り**、
 * `declareAnkan`(自家 p0 = 東/親 の暗槓)の4枚目に対しても槍槓ロンを認める。
 * 国士以外の手(標準/七対子)では暗槓に対する槍槓は不可(= 暗槓成立・従来どおり)。
 *
 * ## 検証の要
 * 応答者の和了形が国士無双(`thirteenOrphans`)のときのみ横取りが成立し、それ以外では
 * たとえ暗槓牌でロンできる形でも暗槓が成立する(engine のガードを検証)。フリテン・頭ハネは
 * 通常ロンと同じ `ronOrder` / `analyzeRon` の再利用で解決される。
 *
 * `HandState` は engine 内部型のため、`createGame` の初期局面の可変フィールド
 * (hands / melds / discards / turn / drawn)を直接上書きして局面を組み立てる。
 */

/** 国士無双の13面待ち(13種の么九牌を各1枚)。任意の么九牌でロン可。 */
const KOKUSHI_13_WAIT = "19m 19p 19s 1234567z";

/** p0(東/親)に「暗槓する4枚目を含む手牌」を仕込み、暗槓宣言待ちにした局面を作る。 */
function armAnkan(
  seed: number,
  ankanKind: string,
): {
  state: EngineState;
  ankanTile: ReturnType<typeof parseTile>;
} {
  const s = createGame({ seed });
  const hand = s.hand;
  if (hand === null)
    throw new Error("hand should exist right after createGame");

  hand.melds.east = [];
  // pool(= hands + drawn)に暗槓する4枚を含める。残り(1s 9s)は任意。
  hand.hands.east = parseTiles(`${ankanKind} ${ankanKind} ${ankanKind} 1s 9s`);
  hand.drawn = parseTile(ankanKind);
  hand.turn = "east";

  const ankanTile = parseTile(ankanKind);
  return {
    state: {
      ...s,
      pending: {
        kind: "humanDiscard",
        canTsumo: false,
        canRiichi: false,
        riichiTiles: [],
        ankanTiles: [ankanTile],
        kakanTiles: [],
        forbiddenDiscards: [],
        locked: false,
      },
    },
    ankanTile,
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
  hand.discards[seat] = discards.flatMap((d) => parseTiles(d));
}

describe("engine: 国士無双の暗槓槍槓(Q17 フォローアップ・#126)", () => {
  it("国士無双テンパイの他家がいると暗槓に槍槓ロンが成立し、暗槓は取り消される", () => {
    const { state, ankanTile } = armAnkan(1, "1m");
    seatWaits(state, "south", KOKUSHI_13_WAIT); // 南(p1)が国士13面待ち
    seatWaits(state, "west", "1p 1p 1p 9p 9p 9p 1s 1s 1s 9s 9s 5s 5s"); // 西は非テンパイ

    const after = declareAnkan(state, ankanTile);

    expect(after.phase).toBe("roundEnd");
    expect(after.lastRound?.kind).toBe("win");
    expect(after.lastRound?.winnerId).toBe("p1");
    // 暗槓は不成立=横取り。槓は成立していない(暗槓取り消し)。
    expect(after.hand?.melds.east).toHaveLength(0);
    // 暗槓者(p0=親)が放銃者として支払い、和了者(p1)が受け取る(役満)。
    expect(after.lastRound?.deltas.p0).toBeLessThan(0);
    expect(after.lastRound?.deltas.p1).toBeGreaterThan(0);
  });

  it("国士以外の手(標準形)は暗槓牌でロンできても槍槓不可=暗槓は成立する", () => {
    // 南は清一色(索子)の 9s 単騎待ち → 9s でロンできる標準形(国士ではない)。
    const SOUTH_CHINITSU = "111s 234s 567s 789s 9s";
    // フィクスチャ前提の固定: この手は 9s で和了でき、その和了形は標準形。
    const w = analyzeWin({
      concealedTiles: [...parseTiles(SOUTH_CHINITSU), parseTile("9s")],
      winningTile: parseTile("9s"),
      winType: "ron",
      seatWind: HONOR.SOUTH,
      roundWind: HONOR.EAST,
    });
    expect(w).not.toBeNull();
    expect(w?.form.kind).toBe("standard");

    const { state, ankanTile } = armAnkan(2, "9s");
    seatWaits(state, "south", SOUTH_CHINITSU);
    seatWaits(state, "west", "1p 1p 1p 9p 9p 9p 1s 1s 1s 9s 9s 5s 5s");

    const after = declareAnkan(state, ankanTile);

    // 国士以外は暗槓に対する槍槓不可 → 暗槓成立(嶺上ツモへ進む)。
    expect(after.phase).toBe("playing");
    expect(after.hand?.melds.east[0].type).toBe("kan");
    expect(after.hand?.melds.east[0].concealed).toBe(true);
    expect(after.hand?.drawn).not.toBeNull(); // 嶺上ツモ済み
    expect(after.pending?.kind).toBe("humanDiscard");
    expect(after.lastRound).toBeNull();
  });

  it("暗槓牌が国士の待ち牌でなければ(中張牌の暗槓)槍槓は成立せず暗槓が成立する", () => {
    // 南は国士13面待ち(待ちは么九牌のみ)。東は中張牌 6p を暗槓 → 待ち外。
    const { state, ankanTile } = armAnkan(3, "6p");
    seatWaits(state, "south", KOKUSHI_13_WAIT);
    seatWaits(state, "west", "1p 1p 1p 9p 9p 9p 1s 1s 1s 9s 9s 5s 5s");

    const after = declareAnkan(state, ankanTile);

    expect(after.phase).toBe("playing");
    expect(after.hand?.melds.east[0].type).toBe("kan");
    expect(after.lastRound).toBeNull();
  });

  it("国士テンパイ者が暗槓牌でフリテンなら槍槓は成立せず暗槓が成立する", () => {
    // 南は国士13面待ちだが自河に 1m(=待ち牌)→ 捨て牌フリテンでロン不可。
    const { state, ankanTile } = armAnkan(4, "1m");
    seatWaits(state, "south", KOKUSHI_13_WAIT, ["1m"]);
    seatWaits(state, "west", "1p 1p 1p 9p 9p 9p 1s 1s 1s 9s 9s 5s 5s");

    const after = declareAnkan(state, ankanTile);

    expect(after.phase).toBe("playing");
    expect(after.hand?.melds.east[0].type).toBe("kan");
    expect(after.lastRound).toBeNull();
  });

  it("複数家が国士でロン可能なら頭ハネ(上家取り=ronOrder)で最先の1人のみ和了", () => {
    // 南(p1)・西(p2)ともに国士13面待ち → ronOrder(east)=[south, west] で南が優先。
    const { state, ankanTile } = armAnkan(5, "1m");
    seatWaits(state, "south", KOKUSHI_13_WAIT);
    seatWaits(state, "west", KOKUSHI_13_WAIT);

    const after = declareAnkan(state, ankanTile);

    expect(after.phase).toBe("roundEnd");
    expect(after.lastRound?.winnerId).toBe("p1");
  });
});
