import {
  createGame,
  declareAnkan,
  declareKakan,
  declareKan,
  declareKita,
  declarePon,
  declareRiichi,
  declareRon,
  declareTsumo,
  discard,
  type EngineState,
  type PlayerId,
  type PlayerNames,
  passRon,
  proceedToNextRound,
  tsumogiri,
} from "@/domain/game/engine";
import { createTile, type Tile } from "@/domain/tiles/tile";
import { isValidPlayerName, limitPlayerName } from "@/lib/playerName";

export const LEGACY_GAME_SESSION_KEY = "four-bros-mahjong.game.v1";
export const GAME_SESSION_KEY = "four-bros-mahjong.game.v3";
// v2 で `names`、v3 で明示的な北抜き操作を追加。旧clientは未知actionを見つけると
// v1 keyを削除するため、v3は別keyへ保存し、旧keyは移行後も一切変更しない。
// 設定側(`localStorage`)を再生時に読み直さず、ジャーナル自身に保存する。
// v1 の記録は既定名を補って v3 形式へ正規化する(`namesOfVersion`)。
const VERSION = 3;
/** v1ジャーナル作成当時の表示名。既存の進行中半荘をデプロイで改名しない。 */
const LEGACY_V1_DEFAULT_NAMES: PlayerNames = ["あなた", "一郎", "二郎", "三郎"];
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
  | { readonly type: "kita" }
  | { readonly type: "ankan"; readonly tile: Tile }
  | { readonly type: "kakan"; readonly tile: Tile }
  | { readonly type: "passRon" }
  | { readonly type: "nextRound" };

export interface GameJournal {
  readonly version: 3;
  readonly seed: number;
  /** この半荘の対局者名(index 0 = 自家)。開始時に固定し、以後の設定変更では変わらない。 */
  readonly names: PlayerNames;
  /** trueならp0の北抜きを操作列へ記録。falseは旧版と同じ自動ガリで再生する。 */
  readonly explicitKita: boolean;
  readonly actions: readonly GameAction[];
}

const noTileActions = new Set([
  "tsumogiri",
  "tsumo",
  "ron",
  "pon",
  "kan",
  "kita",
  "passRon",
  "nextRound",
]);

function isTile(value: unknown): value is Tile {
  if (!value || typeof value !== "object") return false;
  const tile = value as Record<string, unknown>;
  if (!hasOnlyKeys(tile, ["suit", "rank", "isRed"])) return false;
  const suit = tile.suit;
  const rank = tile.rank;
  if (
    (suit !== "man" && suit !== "pin" && suit !== "sou" && suit !== "honor") ||
    typeof rank !== "number" ||
    !Number.isInteger(rank)
  ) {
    return false;
  }
  const validRank =
    (suit === "honor" && rank >= 1 && rank <= 7) ||
    (suit !== "honor" && rank >= 1 && rank <= 9);
  return (
    validRank &&
    typeof tile.isRed === "boolean" &&
    tile.isRed === createTile(suit, rank).isRed
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

function isAction(value: unknown, allowKita: boolean): value is GameAction {
  if (!value || typeof value !== "object") return false;
  const action = value as Record<string, unknown>;
  if (noTileActions.has(String(action.type))) {
    if (action.type === "kita" && !allowKita) return false;
    return hasOnlyKeys(action, ["type"]);
  }
  return (
    ["discard", "riichi", "ankan", "kakan"].includes(String(action.type)) &&
    hasOnlyKeys(action, ["type", "tile"]) &&
    isTile(action.tile)
  );
}

/**
 * 保存された対局者名の妥当性を検証する。
 *
 * 表示名は盤面・結果画面・読み上げへそのまま描画されるため、`sessionStorage` を手で書き換えた
 * 巨大文字列や型不一致を再生前に拒否する(React は文字列を自動エスケープするので XSS ではなく、
 * レイアウト破壊と描画コストの防止が目的)。
 */
function isNames(value: unknown): value is PlayerNames {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((name) => typeof name === "string" && isValidPlayerName(name))
  );
}

/**
 * 版ごとに許される key と対局者名を検証し、v2 の `names` へ正規化する。
 *
 * v1(`names` 無し)は当時の既定名を補って受け入れる。デプロイをまたいで開いたままのタブが
 * 進行中の半荘を失わないための移行措置(`names` は表示名だけを決めるので、既定名を
 * 補っても Wall/RNG・操作列の再生結果は一切変わらない)。
 *
 * v2 の `names` も同じ理由で「拒否より正規化」を優先する。#484 の修正前に書かれた記録は
 * UTF-16 code unit で切り詰められた結果 lone surrogate を末尾に持ち得るため、
 * `limitPlayerName` を通して well-formed 化してから再生する。
 */
function namesOfVersion(value: Record<string, unknown>): PlayerNames | null {
  if (value.version === 1) {
    return hasOnlyKeys(value, ["version", "seed", "actions"])
      ? LEGACY_V1_DEFAULT_NAMES
      : null;
  }
  if (value.version !== 2 && value.version !== VERSION) return null;
  const expectedKeys =
    value.version === VERSION
      ? ["version", "seed", "names", "explicitKita", "actions"]
      : ["version", "seed", "names", "actions"];
  if (!hasOnlyKeys(value, expectedKeys)) return null;
  if (!isNames(value.names)) return null;
  const [east, south, west, bench] = value.names;
  return [
    limitPlayerName(east),
    limitPlayerName(south),
    limitPlayerName(west),
    limitPlayerName(bench),
  ];
}

interface ParsedJournal {
  readonly journal: GameJournal;
  readonly sourceVersion: 1 | 2 | 3;
}

function parseJournalWithVersion(raw: string): ParsedJournal | null {
  if (raw.length * 2 > MAX_JOURNAL_BYTES) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value !== "object") return null;
    const names = namesOfVersion(value);
    const sourceVersion = value.version;
    const explicitKita =
      sourceVersion === VERSION && value.explicitKita === true;
    if (
      names === null ||
      (sourceVersion !== 1 &&
        sourceVersion !== 2 &&
        sourceVersion !== VERSION) ||
      (sourceVersion === VERSION && typeof value.explicitKita !== "boolean") ||
      !Number.isSafeInteger(value.seed) ||
      Number(value.seed) < 0 ||
      Number(value.seed) > 0xffffffff ||
      !Array.isArray(value.actions) ||
      value.actions.length > MAX_JOURNAL_ACTIONS ||
      !value.actions.every((action) => isAction(action, explicitKita))
    ) {
      return null;
    }
    return {
      sourceVersion,
      journal: {
        version: VERSION,
        seed: value.seed as number,
        names,
        explicitKita,
        actions: value.actions as readonly GameAction[],
      },
    };
  } catch {
    return null;
  }
}

export function parseJournal(raw: string): GameJournal | null {
  return parseJournalWithVersion(raw)?.journal ?? null;
}

export function applyGameAction(
  state: EngineState,
  action: GameAction,
  playerId?: PlayerId,
): EngineState {
  switch (action.type) {
    case "discard":
      return discard(state, action.tile, playerId);
    case "tsumogiri":
      return tsumogiri(state, playerId);
    case "riichi":
      return declareRiichi(state, action.tile, playerId);
    case "tsumo":
      return declareTsumo(state, playerId);
    case "ron":
      return declareRon(state, playerId);
    case "pon":
      return declarePon(state, playerId);
    case "kan":
      return declareKan(state, playerId);
    case "kita":
      return declareKita(state, playerId);
    case "ankan":
      return declareAnkan(state, action.tile, playerId);
    case "kakan":
      return declareKakan(state, action.tile, playerId);
    case "passRon":
      return passRon(state, playerId);
    case "nextRound":
      return proceedToNextRound(state);
  }
}

export function replayJournal(journal: GameJournal): EngineState {
  let state = createGame({
    seed: journal.seed,
    names: journal.names,
    explicitKitaPlayerIds: journal.explicitKita ? ["p0"] : [],
  });
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
    const currentRaw = storage.getItem(GAME_SESSION_KEY);
    if (currentRaw !== null) {
      const current = parseJournalWithVersion(currentRaw);
      if (current?.sourceVersion === VERSION) return current.journal;
      storage.removeItem(GAME_SESSION_KEY);
    }

    // 旧keyは旧clientとの共存・rollback用に読取専用とし、破損時も削除しない。
    const legacyRaw = storage.getItem(LEGACY_GAME_SESSION_KEY);
    if (legacyRaw === null) return null;
    const legacy = parseJournalWithVersion(legacyRaw);
    return legacy?.sourceVersion === 1 || legacy?.sourceVersion === 2
      ? legacy.journal
      : null;
  } catch {
    return null;
  }
}

export function saveJournal(storage: Storage, journal: GameJournal): void {
  try {
    storage.setItem(
      GAME_SESSION_KEY,
      JSON.stringify({
        version: VERSION,
        seed: journal.seed,
        names: journal.names,
        explicitKita: journal.explicitKita,
        actions: journal.actions,
      } satisfies GameJournal),
    );
  } catch {
    // 保存不可でも現在タブの対局は継続する。
  }
}
