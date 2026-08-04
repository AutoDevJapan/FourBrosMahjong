import { describe, expect, it } from "vitest";
import { shouldCallMeld } from "@/domain/game/ai";
import type { MeldInput } from "@/domain/hand/decompose";
import type { Meld } from "@/domain/hand/meld";
import { waitingTiles } from "@/domain/hand/tenpai";
import { tileKey } from "@/domain/hand/tile-identity";
import { HONOR, type PlayableWind, type Tile } from "@/domain/tiles/tile";
import {
  chooseAiDiscard,
  createGame,
  declareAnkan,
  declareKakan,
  declareKan,
  declarePon,
  declareRiichi,
  declareRon,
  declareTsumo,
  discard,
  type EngineState,
  passRon,
  proceedToNextRound,
  type SeatKey,
  seatOfPlayer,
  tsumogiri,
} from "./engine";

type Hand = NonNullable<EngineState["hand"]>;

const SEATS: readonly SeatKey[] = ["east", "south", "west"];
const SEAT_WIND: Record<SeatKey, PlayableWind> = {
  east: HONOR.EAST,
  south: HONOR.SOUTH,
  west: HONOR.WEST,
};

function meldInputs(melds: readonly Meld[]): MeldInput[] {
  return melds.map((m) => ({
    tiles: m.tiles,
    isKan: m.type === "kan",
    concealed: m.concealed,
  }));
}

function sameTile(a: Tile, b: Tile): boolean {
  return a.suit === b.suit && a.rank === b.rank && !!a.isRed === !!b.isRed;
}

/** engine の nonFuritenRiichiTiles と同じ判定(自家 p0 でも AI 方針を再現するため)。 */
function nonFuritenTiles(
  hand: Hand,
  seat: SeatKey,
  candidates: readonly Tile[],
): Tile[] {
  if (hand.drawn === null) return [];
  const melds = meldInputs(hand.melds[seat]);
  const pool = [...hand.hands[seat], hand.drawn];
  const ownKeys = new Set(hand.discardHistory[seat].map((t) => tileKey(t)));
  return candidates.filter((candidate) => {
    const index = pool.findIndex((t) => sameTile(t, candidate));
    if (index < 0) return false;
    const rest = [...pool.slice(0, index), ...pool.slice(index + 1)];
    const candidateKey = tileKey(candidate);
    return waitingTiles(rest, melds).every((wait) => {
      const key = tileKey(wait);
      return key !== candidateKey && !ownKeys.has(key);
    });
  });
}

/**
 * 自家(p0)の pending を engine 内の AI 方針(ツモ→カン→リーチ→手牌効率打牌、
 * ロン>大明槓>ポン、役牌基準の鳴き)どおりに解決する決定的ドライバ。
 * これにより全席が「実 engine + AI 方針」で駆動され、issue #295 の
 * オフラインシミュレーションと同じ軌跡を再現する。
 */
function stepHumanAsAi(state: EngineState): EngineState {
  const pending = state.pending;
  const hand = state.hand;
  if (hand === null || pending === null) throw new Error("no pending");
  const seat = seatOfPlayer(hand.seating, "p0");
  if (seat === null) throw new Error("p0 が抜け番なのに pending がある");

  if (pending.kind === "humanReact") {
    if (pending.canRon) return declareRon(state);
    if (pending.canPon || pending.canKan) {
      const call = shouldCallMeld({
        tile: pending.tile,
        melds: hand.melds[seat],
        seatWind: SEAT_WIND[seat],
        roundWind: state.round.wind === "east" ? HONOR.EAST : HONOR.SOUTH,
      });
      if (call) return pending.canKan ? declareKan(state) : declarePon(state);
    }
    return passRon(state);
  }

  if (pending.locked) {
    if (pending.canTsumo) return declareTsumo(state);
    if (pending.ankanTiles.length > 0)
      return declareAnkan(state, pending.ankanTiles[0]);
    return tsumogiri(state);
  }
  if (pending.canTsumo) return declareTsumo(state);
  if (pending.kakanTiles.length > 0)
    return declareKakan(state, pending.kakanTiles[0]);
  if (pending.ankanTiles.length > 0)
    return declareAnkan(state, pending.ankanTiles[0]);

  if (pending.canRiichi && pending.riichiTiles.length > 0) {
    const declarable = nonFuritenTiles(hand, seat, pending.riichiTiles);
    if (declarable.length > 0) {
      const selected = chooseAiDiscard(hand, seat, hand.drawn);
      const tile =
        declarable.find((c) => sameTile(c, selected)) ?? declarable[0];
      return declareRiichi(state, tile);
    }
  }
  // engine 本体と同じ関数へ禁止牌を候補制約として渡す。`pool` から削ると向聴・受け入れの
  // 評価枚数が `14 − 3×副露数` を下回るため、禁止牌も評価対象には残す(#424 / #303)。
  const chosen = chooseAiDiscard(
    hand,
    seat,
    hand.drawn,
    pending.forbiddenDiscards,
  );
  return discard(state, chosen);
}

interface RiichiEvent {
  round: number;
  seat: SeatKey;
  occupant: string;
  /** 宣言時点で待ち牌が自河(宣言牌を含む)にある = フリテンリーチか。 */
  furiten: boolean;
}

/** 新規リーチ宣言を検出し、宣言時点のフリテン状態を記録する。 */
function scanRiichi(
  state: EngineState,
  seen: Set<string>,
  events: RiichiEvent[],
): void {
  const hand = state.hand;
  if (hand === null) return;
  for (const seat of SEATS) {
    if (!hand.riichi[seat]) continue;
    const key = `${state.roundsPlayed}:${seat}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const waits = waitingTiles(hand.hands[seat], meldInputs(hand.melds[seat]));
    // 判定オラクルも engine と同じ入力(打牌履歴)を見る。表示用の河を見ると、
    // 鳴かれた牌が原因のフリテンリーチを取り逃がす(#395)。
    const ownKeys = new Set(hand.discardHistory[seat].map((t) => tileKey(t)));
    events.push({
      round: state.roundsPlayed,
      seat,
      occupant: hand.seating[seat],
      furiten: waits.some((w) => ownKeys.has(tileKey(w))),
    });
  }
}

/** 半荘1回を全席 AI 方針で最後まで駆動し、リーチ宣言イベントを収集する。 */
function driveGame(seed: number): {
  events: RiichiEvent[];
  finished: boolean;
} {
  let state = createGame({ seed });
  const seen = new Set<string>();
  const events: RiichiEvent[] = [];
  for (let guard = 0; guard < 50000; guard++) {
    scanRiichi(state, seen, events);
    if (state.phase === "gameEnd") return { events, finished: true };
    if (state.phase === "roundEnd") {
      state = proceedToNextRound(state);
      continue;
    }
    if (state.pending !== null) {
      state = stepHumanAsAi(state);
      continue;
    }
    throw new Error(`seed=${seed}: playing なのに pending なしで停止した`);
  }
  return { events, finished: false };
}

describe("engine: AI はフリテンのままリーチを宣言しない(#295)", () => {
  it("seed=18: 修正前に西家(p1)が7局目(roundsPlayed=6)で 6s/9s 待ちのフリテンリーチを宣言していた局面で、フリテンリーチが発生しない", () => {
    const { events, finished } = driveGame(18);
    expect(finished).toBe(true);
    // 決定的再現局面(issue #295): 修正前は round=6 / west / p1 がフリテンリーチ。
    for (const event of events) {
      expect(event, `round=${event.round} seat=${event.seat}`).toMatchObject({
        furiten: false,
      });
    }
    // リーチ自体は依然発生する(リーチ判断が丸ごと死んでいないことの確認)。
    expect(events.length).toBeGreaterThan(0);
  });

  it.each([1, 9, 25, 27])(
    "seed=%i: 修正前にフリテンリーチが発生していた半荘でフリテンリーチ 0 件のまま完走する",
    (seed) => {
      const { events, finished } = driveGame(seed);
      expect(finished).toBe(true);
      expect(events.filter((e) => e.furiten)).toEqual([]);
      expect(events.length).toBeGreaterThan(0);
    },
  );
});
