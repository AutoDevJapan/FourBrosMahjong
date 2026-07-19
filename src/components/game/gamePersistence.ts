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
// engine は最大32局で終了し、完走fixtureも5,000遷移を安全ガードにしている。
// これを超える履歴は正規の対局から生成されないものとして、再生前に拒否する。
export const MAX_JOURNAL_ACTIONS = 5_000;
// sessionStorage 由来の文字列はメインスレッドで同期 parse される。JSON.parse 前に
// UTF-16 の保存量（1 code unit = 2 bytes）を制限し、巨大入力による初期描画停止を防ぐ。
export const MAX_JOURNAL_BYTES = 1024 * 1024;

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
  if (!hasOnlyKeys(tile, ["suit", "rank", "isRed"])) return false;
  const suit = tile.suit;
  const rank = tile.rank;
  const validRank =
    (suit === "honor" &&
      Number.isInteger(rank) &&
      Number(rank) >= 1 &&
      Number(rank) <= 7) ||
    (["man", "pin", "sou"].includes(String(suit)) &&
      Number.isInteger(rank) &&
      Number(rank) >= 1 &&
      Number(rank) <= 9);
  return (
    validRank &&
    typeof tile.isRed === "boolean" &&
    (!tile.isRed || (suit !== "honor" && rank === 5))
  );
}

/**
 * 保存データ検証用: 期待キー**のみ**を持つオブジェクトか。
 * ジャーナル(`sessionStorage`)と戦績(`matchHistory.ts` / `localStorage`)で共用する。
 */
export function hasOnlyKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length && expected.every((key) => key in value)
  );
}

function isAction(value: unknown): value is GameAction {
  if (!value || typeof value !== "object") return false;
  const action = value as Record<string, unknown>;
  if (noTileActions.has(String(action.type))) {
    return hasOnlyKeys(action, ["type"]);
  }
  return (
    ["discard", "riichi", "ankan", "kakan"].includes(String(action.type)) &&
    hasOnlyKeys(action, ["type", "tile"]) &&
    isTile(action.tile)
  );
}

export function parseJournal(raw: string): GameJournal | null {
  if (raw.length * 2 > MAX_JOURNAL_BYTES) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      !value ||
      typeof value !== "object" ||
      !hasOnlyKeys(value, ["version", "seed", "actions"]) ||
      value.version !== VERSION ||
      !Number.isSafeInteger(value.seed) ||
      Number(value.seed) < 0 ||
      Number(value.seed) > 0xffffffff ||
      !Array.isArray(value.actions) ||
      value.actions.length > MAX_JOURNAL_ACTIONS ||
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
