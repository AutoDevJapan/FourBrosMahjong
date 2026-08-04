import type { RoundNumber, RoundState, RoundWind } from "../../round/round";
import type { PlayerRing } from "../../round/seat";
import type { Tile } from "../../tiles/tile";
import {
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
  type Pending,
  type PlayerId,
  passRon,
  proceedToNextRound,
  type RoundConclusion,
  seatOfPlayer,
  tsumogiri,
  withdrawPot,
} from "../engine";

export type DriverActionKind =
  | "discard"
  | "tsumogiri"
  | "declareRiichi"
  | "declarePon"
  | "declareKan"
  | "declareAnkan"
  | "declareKakan"
  | "declareTsumo"
  | "declareRon"
  | "passRon"
  | "proceedToNextRound";

export type DriverPolicy =
  | "aggressive"
  | "kanFirst"
  | "passive"
  | "riichiFirst";

type HumanDiscard = Extract<Pending, { kind: "humanDiscard" }>;

export function firstLegalDiscard(
  state: EngineState,
  pending: HumanDiscard,
): Tile {
  const hand = state.hand;
  const seat = hand ? seatOfPlayer(hand.seating, "p0") : null;
  const forbidden = pending.forbiddenDiscards;
  const isForbidden = (tile: Tile): boolean =>
    forbidden.some(
      (candidate) =>
        candidate.suit === tile.suit && candidate.rank === tile.rank,
    );
  let tile = hand?.drawn?.tile;
  if ((tile == null || isForbidden(tile)) && hand && seat) {
    tile = hand.hands[seat].find((candidate) => !isForbidden(candidate));
  }
  if (tile == null) throw new Error("humanDiscard without a discardable tile");
  return tile;
}

/** 提示された合法手を方策に従って1つ選び、1手進める。 */
export function advanceEngine(
  state: EngineState,
  policy: DriverPolicy,
  selectDiscard: (state: EngineState, pending: HumanDiscard) => Tile,
): { readonly next: EngineState; readonly action: DriverActionKind } {
  if (state.phase === "roundEnd") {
    return {
      next: proceedToNextRound(state),
      action: "proceedToNextRound",
    };
  }

  const pending = state.pending;
  if (pending?.kind === "humanReact") {
    if (pending.canRon)
      return { next: declareRon(state), action: "declareRon" };
    if (policy === "passive" || policy === "riichiFirst")
      return { next: passRon(state), action: "passRon" };
    if (policy === "kanFirst" && pending.canKan)
      return { next: declareKan(state), action: "declareKan" };
    if (pending.canPon)
      return { next: declarePon(state), action: "declarePon" };
    if (pending.canKan)
      return { next: declareKan(state), action: "declareKan" };
    return { next: passRon(state), action: "passRon" };
  }

  if (pending?.kind === "humanDiscard") {
    if (pending.canTsumo)
      return { next: declareTsumo(state), action: "declareTsumo" };
    if (pending.locked) return { next: tsumogiri(state), action: "tsumogiri" };

    if (policy !== "passive") {
      if (policy === "kanFirst" && pending.ankanTiles.length > 0) {
        return {
          next: declareAnkan(state, pending.ankanTiles[0]),
          action: "declareAnkan",
        };
      }
      if (pending.kakanTiles.length > 0) {
        return {
          next: declareKakan(state, pending.kakanTiles[0]),
          action: "declareKakan",
        };
      }
      if (pending.ankanTiles.length > 0) {
        return {
          next: declareAnkan(state, pending.ankanTiles[0]),
          action: "declareAnkan",
        };
      }
    }

    if (pending.canRiichi && policy !== "passive") {
      return {
        next: declareRiichi(state, pending.riichiTiles[0]),
        action: "declareRiichi",
      };
    }
    return {
      next: discard(state, selectDiscard(state, pending)),
      action: "discard",
    };
  }

  throw new Error(
    `stuck: phase=${state.phase} pending=${state.pending?.kind ?? "none"}`,
  );
}

/** 起家=p0 の固定円環(createGame と同一)。 */
export const TEST_PLAYER_ORDER: PlayerRing<PlayerId> = ["p0", "p1", "p2", "p3"];

function testRoundAt(
  wind: RoundWind,
  roundNumber: RoundNumber,
  honba = 0,
): RoundState<PlayerId> {
  return { order: TEST_PLAYER_ORDER, wind, roundNumber, honba };
}

export const OORASU_DRAW: RoundConclusion = {
  outcome: "dealerPasses",
  isDraw: true,
  summary: {
    kind: "draw",
    label: "流局",
    deltas: { p0: 0, p1: 0, p2: 0, p3: 0 },
  },
};

export function endGameStateWith(
  points: Record<PlayerId, number>,
  options: {
    seed: number;
    overrides?: Partial<EngineState>;
    clearPot?: boolean;
  },
): EngineState {
  const created = createGame({ seed: options.seed });
  const base = options.clearPot ? withdrawPot(created) : created;
  return {
    ...base,
    round: testRoundAt("south", 4),
    points,
    ...options.overrides,
  };
}
