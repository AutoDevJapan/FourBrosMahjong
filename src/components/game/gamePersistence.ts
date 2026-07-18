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
  passRon,
  proceedToNextRound,
  tsumogiri,
} from "@/domain/game/engine";
import type { Tile } from "@/domain/tiles/tile";

const GAME_SESSION_KEY = "four-bros-mahjong.game.v1";
const VERSION = 1;

export type GameAction =
  | { readonly type: "discard"; readonly tile: Tile }
  | { readonly type: "tsumogiri" }
  | { readonly type: "riichi"; readonly tile: Tile }
  | { readonly type: "tsumo" }
  | { readonly type: "ron" }
  | { readonly type: "pon" }
  | { readonly type: "kan" }
  | { readonly type: "ankan"; readonly tile: Tile }
  | { readonly type: "kakan"; readonly tile: Tile }
  | { readonly type: "passRon" }
  | { readonly type: "nextRound" };

export interface GameJournal {
  readonly version: 1;
  readonly seed: number;
  readonly actions: readonly GameAction[];
}

const noTileActions = new Set([
  "tsumogiri",
  "tsumo",
  "ron",
  "pon",
  "kan",
  "passRon",
  "nextRound",
]);

function isTile(value: unknown): value is Tile {
  if (!value || typeof value !== "object") return false;
  const tile = value as Record<string, unknown>;
  return (
    ["man", "pin", "sou", "honor"].includes(String(tile.suit)) &&
    Number.isInteger(tile.rank) &&
    typeof tile.isRed === "boolean"
  );
}

function isAction(value: unknown): value is GameAction {
  if (!value || typeof value !== "object") return false;
  const action = value as Record<string, unknown>;
  if (noTileActions.has(String(action.type))) return true;
  return (
    ["discard", "riichi", "ankan", "kakan"].includes(String(action.type)) &&
    isTile(action.tile)
  );
}

export function parseJournal(raw: string): GameJournal | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      value.version !== VERSION ||
      !Number.isSafeInteger(value.seed) ||
      Number(value.seed) < 0 ||
      !Array.isArray(value.actions) ||
      value.actions.length > 100_000 ||
      !value.actions.every(isAction)
    ) {
      return null;
    }
    return value as unknown as GameJournal;
  } catch {
    return null;
  }
}

export function applyGameAction(
  state: EngineState,
  action: GameAction,
): EngineState {
  switch (action.type) {
    case "discard":
      return discard(state, action.tile);
    case "tsumogiri":
      return tsumogiri(state);
    case "riichi":
      return declareRiichi(state, action.tile);
    case "tsumo":
      return declareTsumo(state);
    case "ron":
      return declareRon(state);
    case "pon":
      return declarePon(state);
    case "kan":
      return declareKan(state);
    case "ankan":
      return declareAnkan(state, action.tile);
    case "kakan":
      return declareKakan(state, action.tile);
    case "passRon":
      return passRon(state);
    case "nextRound":
      return proceedToNextRound(state);
  }
}

export function replayJournal(journal: GameJournal): EngineState {
  let state = createGame({ seed: journal.seed });
  for (const [index, action] of journal.actions.entries()) {
    const next = applyGameAction(state, action);
    // engine の公開操作は不正な局面・牌を例外ではなく同一 state の no-op で拒否する。
    // 保存履歴では no-op を読み飛ばすと後続 action を異なる局面へ適用してしまうため、
    // ジャーナル破損として呼び出し元へ通知し、新規対局へのフォールバックを促す。
    if (next === state) {
      throw new Error(
        `Invalid game journal action at index ${index}: ${action.type}`,
      );
    }
    state = next;
  }
  return state;
}

export function loadJournal(storage: Storage): GameJournal | null {
  try {
    const raw = storage.getItem(GAME_SESSION_KEY);
    if (raw === null) return null;
    const journal = parseJournal(raw);
    if (journal === null) storage.removeItem(GAME_SESSION_KEY);
    return journal;
  } catch {
    return null;
  }
}

export function saveJournal(storage: Storage, journal: GameJournal): void {
  try {
    storage.setItem(GAME_SESSION_KEY, JSON.stringify(journal));
  } catch {
    // 保存不可でも現在タブの対局は継続する。
  }
}
