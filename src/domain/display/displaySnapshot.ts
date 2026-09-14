import type { GamePhase, Pending, PlayerId } from "@/domain/game/engine";
import type {
  GameViewState,
  SeatPosition,
  SlotContent,
  TileData,
} from "@/domain/game/viewTypes";
import { isRedDora } from "@/domain/tiles/tile";
import type { LocalDisplaySource } from "./displaySource";

export const DISPLAY_PROTOCOL = "four-bros-mahjong/local-display";
export const DISPLAY_PROTOCOL_VERSION = 1;
const POSITIONS: readonly SeatPosition[] = ["self", "left", "across", "right"];

export interface DisplayInput {
  readonly playerId: PlayerId;
  readonly isHost: boolean;
  readonly view: GameViewState;
  readonly phase: GamePhase;
  readonly pending: Pending;
  /** Absent for the online provider: preserve its existing 2D UI. */
  readonly displaySource?: LocalDisplaySource;
}

type TileDisplayAction = "discard" | "riichi" | "ankan" | "kakan";
type SimpleDisplayAction =
  | "tsumogiri"
  | "tsumo"
  | "ron"
  | "pon"
  | "kan"
  | "kita"
  | "passRon"
  | "nextRound"
  | "newGame";

export type DisplayControls = {
  readonly [K in TileDisplayAction]: (tile: TileData) => void;
} & { readonly [K in SimpleDisplayAction]: () => void };

/** Renderer DTO, deliberately not a domain Tile or a factory replacement. */
interface DisplayTile {
  readonly suit: TileData["suit"];
  readonly rank: number;
  readonly red: boolean;
}

export type DisplayOption =
  | {
      readonly id: string;
      readonly action: TileDisplayAction;
      readonly tile: DisplayTile;
    }
  | { readonly id: string; readonly action: SimpleDisplayAction };

/** Explicit projection; never spread provider/view objects into the wire DTO. */
function tile(value: TileData): DisplayTile {
  return { suit: value.suit, rank: value.rank, red: isRedDora(value) };
}

function slot(position: SeatPosition, content: SlotContent) {
  const player = content.player;
  const common = {
    position,
    playerId: player.playerId,
    name: player.name,
    points: player.points,
    pointsDelta: player.pointsDelta ?? 0,
  };
  if (content.kind === "bench") return { ...common, kind: "bench" as const };
  const seated = content.player;
  const own = position === "self";
  return {
    ...common,
    kind: "seated" as const,
    seatWind: seated.seatWind,
    status: {
      isDealer: seated.status?.isDealer === true,
      isCurrentTurn: seated.status?.isCurrentTurn === true,
      hasDeclaredRiichi: seated.status?.hasDeclaredRiichi === true,
      ...(own && seated.status?.furitenReason
        ? { furitenReason: seated.status.furitenReason }
        : {}),
    },
    ...(own
      ? { hand: (seated.hand ?? []).map(tile) }
      : { handCount: seated.handCount ?? 0 }),
    melds: (seated.melds ?? []).map((meld) => ({
      type: meld.type,
      concealed: meld.concealed,
      tiles: meld.tiles.map(tile),
    })),
    kitaCount: seated.kitaCount,
    discards: seated.discards.map((discard) => ({
      ...tile(discard),
      isRiichi: discard.isRiichi === true,
    })),
  };
}

function validateOwners(input: DisplayInput) {
  const slots = POSITIONS.map((position) => input.view.slots[position]);
  const seats = slots.filter((content) => content.kind === "seated");
  if (
    slots.some((content) => !content) ||
    input.view.slots.self.player.playerId !== input.playerId ||
    new Set(slots.map((content) => content.player.playerId)).size !== 4 ||
    seats.length !== 3 ||
    slots.filter((content) => content.kind === "bench").length !== 1 ||
    new Set(seats.map((content) => content.player.seatWind)).size !== 3
  ) {
    throw new TypeError("Invalid display ownership/seat boundary");
  }
}

function sameTile(a: TileData, b: TileData): boolean {
  // Existing controls also normalize the selected tile kind, not a renderer ID.
  return a.suit === b.suit && a.rank === b.rank;
}

/** Consume existing capabilities; engine remains the final action authority. */
function options(input: DisplayInput): readonly DisplayOption[] {
  const result: DisplayOption[] = [];
  const add = (action: SimpleDisplayAction) => {
    result.push({ id: `option-${result.length}`, action });
  };
  const addTile = (action: TileDisplayAction, value: TileData) => {
    result.push({ id: `option-${result.length}`, action, tile: tile(value) });
  };
  if (input.phase === "roundEnd") {
    if (input.isHost) add("nextRound");
    return result;
  }
  if (input.phase === "gameEnd") {
    if (input.isHost) add("newGame");
    return result;
  }
  const { pending } = input;
  const self = input.view.slots.self;
  if (
    pending === null ||
    (pending.playerId ?? "p0") !== input.playerId ||
    self.kind !== "seated"
  ) {
    return result;
  }
  if (pending.kind === "humanReact") {
    if (pending.canRon) add("ron");
    if (pending.canPon) add("pon");
    if (pending.canKan) add("kan");
    add("passRon");
    return result;
  }
  if (pending.canTsumo) add("tsumo");
  if (pending.canKita) add("kita");
  if (pending.locked) add("tsumogiri");
  for (const value of self.player.hand ?? []) {
    if (
      !pending.locked &&
      !pending.forbiddenDiscards.some((forbidden) => sameTile(forbidden, value))
    ) {
      addTile("discard", value);
      if (
        pending.canRiichi &&
        pending.riichiTiles.some((candidate) => sameTile(candidate, value))
      ) {
        addTile("riichi", value);
      }
    }
  }
  for (const value of pending.ankanTiles) addTile("ankan", value);
  for (const value of pending.kakanTiles) addTile("kakan", value);
  return result;
}

export function projectDisplaySnapshot(input: DisplayInput) {
  validateOwners(input);
  const { tableInfo, dora, result } = input.view;
  return {
    playerId: input.playerId,
    phase: input.phase,
    slots: POSITIONS.map((position) =>
      slot(position, input.view.slots[position]),
    ),
    tableInfo: {
      roundWind: tableInfo.roundWind,
      handNumber: tableInfo.handNumber,
      honba: tableInfo.honba,
      riichiSticks: tableInfo.riichiSticks,
      remainingLiveTiles: tableInfo.remainingLiveTiles,
      dice: [tableInfo.dice[0], tableInfo.dice[1]],
      doraCount: tableInfo.doraCount,
    },
    dora: {
      indicators: dora.indicators.map(tile),
      uraIndicatorCount: dora.uraIndicatorCount ?? 0,
      uraIndicators:
        input.phase === "playing" ? [] : (dora.uraIndicators ?? []).map(tile),
    },
    result:
      input.phase === "gameEnd" && result
        ? {
            players: result.players.map((player) => ({
              playerId: player.playerId,
              name: player.name,
              rank: player.rank,
              rawScore: player.rawScore,
              uma: player.uma,
              bonus: player.bonus,
              soshiiTotal: player.soshiiTotal,
            })),
          }
        : null,
    options: options(input),
  };
}

export interface DisplayEnvelope {
  readonly protocol: typeof DISPLAY_PROTOCOL;
  readonly version: typeof DISPLAY_PROTOCOL_VERSION;
  readonly sessionId: string;
  readonly revision: number;
  readonly mode: "restore" | "live";
  readonly snapshot: ReturnType<typeof projectDisplaySnapshot>;
}

function freezeDto<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeDto(child);
    Object.freeze(value);
  }
  return value;
}

/** Unsupported providers yield no DTO; callers retain their existing 2D UI. */
export function createDisplayEnvelope(
  input: DisplayInput,
  mode: DisplayEnvelope["mode"],
): DisplayEnvelope | null {
  const source = input.displaySource;
  if (source?.kind !== "local") return null;
  if (
    !source.sessionId ||
    source.sessionId.length > 96 ||
    !Number.isSafeInteger(source.revision) ||
    source.revision < 0
  ) {
    throw new TypeError("Invalid local display source");
  }
  return freezeDto({
    protocol: DISPLAY_PROTOCOL,
    version: DISPLAY_PROTOCOL_VERSION,
    sessionId: source.sessionId,
    revision: source.revision,
    mode,
    snapshot: projectDisplaySnapshot(input),
  });
}
