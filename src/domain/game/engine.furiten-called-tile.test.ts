import { describe, expect, it } from "vitest";
import { parseTile, parseTiles } from "@/domain/hand/notation";
import { sameKind } from "@/domain/hand/tile-identity";
import type { Tile } from "@/domain/tiles/tile";
import {
  createGame,
  declareRon,
  discard,
  type EngineState,
  type SeatKey,
  seatOfPlayer,
} from "./engine";

/**
 * 捨て牌フリテンの恒久性(issue #395 / spec 2.4)。
 *
 * 他家に鳴かれた牌は河(表示)からは消えるが、**自分が打った事実は消えない**ため
 * 捨て牌フリテンは解除されない。engine が河(`discards`)と打牌履歴を同一配列で
 * 兼用していると、鳴かれた瞬間にフリテンが解除されて不正ロンが成立する。
 *
 * 国士無双13面待ち(全13種が待ち)を使い、白(5z)を打った時点で恒久フリテンに
 * なることを利用して、鳴きの有無だけを変えた3ケースで固定する。
 */

/** 国士無双13面待ち(門前13枚 / 全13種が待ち)。 */
const KOKUSHI_13_WAIT = "1m 9m 1p 9p 1s 9s 1z 2z 3z 4z 5z 6z 7z";

/** AI の `shouldCallMeld` が確実にポンする牌種(白 = 三元牌)。 */
const PON_TILE = "5z";

/** 国士のロン牌(自家の待ちの1つ。白とは別種なので鳴きの影響を受けない)。 */
const RON_TILE = "1m";

interface Fixture {
  readonly state: EngineState;
  readonly drawnTile: Tile;
}

/**
 * 自家(東)が国士13面待ちで `drawn` を打つ直前の局面を組む。
 *
 * `southHoldsPonTiles` が true なら南(AI)に白2枚を持たせ、自家の白打ちを
 * 確実にポンさせる(= 自家の河から白が消える)。
 */
function armKokushiTenpai(
  seed: number,
  drawn: string,
  southHoldsPonTiles: boolean,
): Fixture {
  const base = createGame({ seed });
  const hand = base.hand;
  if (hand === null)
    throw new Error("hand should exist right after createGame");
  if (seatOfPlayer(hand.seating, "p0") !== "east") {
    throw new Error("初局の自家は東であることを前提にしたフィクスチャ");
  }

  for (const seat of ["east", "south", "west"] as SeatKey[]) {
    hand.melds[seat] = [];
    hand.discards[seat] = [];
    hand.discardHistory[seat] = [];
    hand.riichi[seat] = false;
    hand.riichiMiss[seat] = false;
    hand.tempMiss[seat] = false;
  }
  hand.hands.east = parseTiles(KOKUSHI_13_WAIT);
  // サンマの萬子は一萬・九萬のみ(`tileSet.ts`)。存在しない 2〜8萬 は使わない。
  hand.hands.south = southHoldsPonTiles
    ? parseTiles("5z 5z 13567p 3456s 9m 9p")
    : parseTiles("2p 2s 13567p 3456s 9m 9p");
  // 西は白を持たず(ポン競合なし)、かつテンパイから遠い散らばり手(局が
  // 自家の手番へ戻る前に終わらないようにする)。
  hand.hands.west = parseTiles("1m 1m 9m 9m 23p 56p 8p 23s 5s 8s");
  const drawnTile = parseTile(drawn);
  hand.drawn = drawnTile;
  hand.turn = "east";

  return {
    drawnTile,
    state: {
      ...base,
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
    },
  };
}

/** 自家に「他家の打牌へのロン機会」を与える(頭ハネ解決を経ずに直接組む)。 */
function armHumanRon(
  state: EngineState,
  tile: Tile,
  from: SeatKey,
): EngineState {
  const hand = state.hand;
  if (hand === null) throw new Error("hand should exist");
  hand.pendingDiscard = { seat: from, tile };
  return {
    ...state,
    pending: {
      kind: "humanReact",
      tile,
      from,
      canRon: true,
      canPon: false,
      canKan: false,
    },
  };
}

describe("engine: 鳴かれた牌の捨て牌フリテン(#395)", () => {
  it("対照: 待ち牌を打っていなければ国士無双でロンできる", () => {
    // 5s は国士の待ちに含まれないため、打ってもフリテンにならない。
    const { state, drawnTile } = armKokushiTenpai(3951, "5s", false);
    const after = discard(state, drawnTile);
    expect(after.phase).toBe("playing");

    const won = declareRon(armHumanRon(after, parseTile(RON_TILE), "west"));

    // 役満の点差で飛び終了しうるため phase は roundEnd / gameEnd のいずれか。
    expect(won.phase).not.toBe("playing");
    expect(won.lastRound?.kind).toBe("win");
    expect(won.lastRound?.winnerId).toBe("p0");
    expect(won.lastRound?.winDetails?.yaku.map((y) => y.name)).toContain(
      "国士無双",
    );
  });

  it("対照: 待ち牌(白)を打って鳴かれなければ捨て牌フリテンでロンできない", () => {
    const { state, drawnTile } = armKokushiTenpai(3952, PON_TILE, false);
    const after = discard(state, drawnTile);
    expect(after.phase).toBe("playing");
    // 鳴かれていないので白は河に残る。
    expect(after.hand?.discards.east.some((t) => sameKind(t, drawnTile))).toBe(
      true,
    );

    const won = declareRon(armHumanRon(after, parseTile(RON_TILE), "west"));

    expect(won.phase).toBe("playing");
    expect(won.lastRound?.kind).not.toBe("win");
  });

  it("待ち牌(白)を打って他家にポンされ河から消えても捨て牌フリテンは解除されない", () => {
    const { state, drawnTile } = armKokushiTenpai(3953, PON_TILE, true);
    const after = discard(state, drawnTile);
    expect(after.phase).toBe("playing");

    // フィクスチャの前提: 南がポンし、自家の河から白が実体ごと消えている。
    const melds = after.hand?.melds.south;
    if (melds === undefined) throw new Error("ポン後も hand は存在するはず");
    expect(melds).toHaveLength(1);
    expect(melds[0].type).toBe("pon");
    expect(sameKind(melds[0].tiles[0], drawnTile)).toBe(true);
    expect(after.hand?.discards.east.some((t) => sameKind(t, drawnTile))).toBe(
      false,
    );
    // 判定用の打牌履歴には残っている(本 PR の核心)。
    expect(
      after.hand?.discardHistory.east.some((t) => sameKind(t, drawnTile)),
    ).toBe(true);

    const won = declareRon(armHumanRon(after, parseTile(RON_TILE), "west"));

    // 捨て牌フリテンは恒久。鳴きは自分の意思と無関係な事象であり解除しない。
    expect(won.phase).toBe("playing");
    expect(won.lastRound?.kind).not.toBe("win");
  });
});

/**
 * AI のフリテンリーチ回避(#295)も同じ入力契約に従う(#395)。
 *
 * `engine.ai-furiten-riichi.test.ts` のランダム完走ドライバでは「打った牌が
 * 鳴かれてフリテンが解除される」局面が出現しないため、ここで決定的に固定する。
 * 上の3ケースが実エンジンのポン経路(河から実体が消える)を通しているので、
 * ここでは AI のリーチ判断だけを分離して観測する。
 */
describe("engine: 鳴かれた牌によるフリテンでも AI はリーチしない(#395 / #295)", () => {
  /** 3面子 + 99s(頭)+ 34s(両面 2s/5s 待ち)。他の打牌ではテンパイを維持できない。 */
  const SOUTH_RYANMEN_TENPAI = "123p 456p 789p 99s 34s";

  /**
   * 南(AI)が 2s/5s 待ちでテンパイし、自家(東)の打牌で手番が回る局面を組む。
   *
   * `southDiscardedWait` が true なら「南が待ち牌 5s を打ち、その 5s が鳴かれて
   * 河から消えた」後の状態(河は空・打牌履歴には残る・`callsMade`)を表す。
   */
  function armSouthRiichiDecision(
    seed: number,
    southDiscardedWait: boolean,
  ): EngineState {
    const base = createGame({ seed });
    const hand = base.hand;
    if (hand === null)
      throw new Error("hand should exist right after createGame");

    for (const seat of ["east", "south", "west"] as SeatKey[]) {
      hand.melds[seat] = [];
      hand.discards[seat] = [];
      hand.discardHistory[seat] = [];
      hand.riichi[seat] = false;
      hand.riichiMiss[seat] = false;
      hand.tempMiss[seat] = false;
    }
    hand.hands.south = parseTiles(SOUTH_RYANMEN_TENPAI);
    if (southDiscardedWait) {
      hand.discardHistory.south = parseTiles("5s");
      hand.callsMade = true; // 鳴きが入った局
    }
    hand.hands.east = parseTiles("1m 9m 1p 9p 1s 9s 1z 2z 3z 5z 6z 7z 2p");
    hand.hands.west = parseTiles("1m 9m 9p 2p 5p 8p 2s 8s 9s 1z 2z 6z 7z");
    hand.drawn = parseTile("8p"); // 誰にも鳴かれず、南のテンパイにも無関係
    hand.turn = "east";

    return {
      ...base,
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

  it("対照: 待ち牌を打っていなければ南はリーチを宣言する", () => {
    const after = discard(armSouthRiichiDecision(3950, false), parseTile("8p"));
    expect(after.phase).toBe("playing");
    expect(after.hand?.riichi.south).toBe(true);
  });

  it("待ち牌が鳴かれて河から消えていても、南はフリテンリーチを宣言しない", () => {
    const after = discard(armSouthRiichiDecision(3950, true), parseTile("8p"));
    expect(after.phase).toBe("playing");
    // フィクスチャの前提: 待ち牌 5s は河には無いが打牌履歴には残っている。
    const wait = parseTile("5s");
    expect(after.hand?.discards.south.some((t) => sameKind(t, wait))).toBe(
      false,
    );
    expect(
      after.hand?.discardHistory.south.some((t) => sameKind(t, wait)),
    ).toBe(true);
    expect(after.hand?.riichi.south).toBe(false);
  });
});
