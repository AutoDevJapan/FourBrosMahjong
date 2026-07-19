/**
 * 対局履歴(戦績)の `localStorage` 永続化(issue #293)。
 *
 * 半荘終了時の確定結果(最終順位・素点/ウマ/祝儀のソシー内訳・終了日時)を
 * 端末ローカルへ追記保存し、`/history`(戦績画面)で新しい順に閲覧できるようにする。
 * バックエンドは持たずクライアント完結(スペック6 6.9)。保存するのは
 * **確定済みの表示値のみ**であり、順位決定・精算ロジック(スペック3)は一切含めない。
 *
 * `sessionStorage` のジャーナル(`gamePersistence.ts`)と同様に、読み込み時は
 * 形状を厳密検証し、件数・容量に上限を設けて巨大入力や破損データから防御する。
 */
import { hasOnlyKeys } from "./gamePersistence";

/** `localStorage` の保存キー。形式変更時は version を上げて別キーにする。 */
export const MATCH_HISTORY_KEY = "four-bros-mahjong.history.v1";
const VERSION = 1;
/** 保存する半荘結果の最大件数。超過時は最古(末尾)から破棄する。 */
export const MAX_HISTORY_ENTRIES = 20;
/**
 * `localStorage` 由来の文字列はメインスレッドで同期 parse される。JSON.parse 前に
 * UTF-16 の保存量(1 code unit = 2 bytes)を制限し、巨大入力による描画停止を防ぐ
 * (`gamePersistence.ts` の `MAX_JOURNAL_BYTES` と同じ防御)。
 */
export const MAX_HISTORY_BYTES = 128 * 1024;

/** 4兄弟のうち1人分の確定済みソシー内訳(`ResultPlayerView` と同形の保存用スナップショット)。 */
interface MatchHistoryPlayer {
  readonly name: string;
  /** 最終順位(1〜4)。 */
  readonly rank: number;
  /** ① 素点(スペック3 3.3①)。 */
  readonly rawScore: number;
  /** ② 順位ウマ(スペック3 3.3②)。 */
  readonly uma: number;
  /** ③ 役満祝儀(スペック3 3.3③)。 */
  readonly bonus: number;
  /** ソシー合計(= rawScore + uma + bonus)。 */
  readonly soshiiTotal: number;
}

/** 半荘1回分の戦績レコード。 */
export interface MatchHistoryEntry {
  /**
   * 半荘のジャーナル seed(uint32)。終局済みジャーナルをリロード再生した際に
   * 同一半荘を二重保存しないための識別子として使う(終局後の値なので公開しても
   * 対局の完全性には影響しない)。
   */
  readonly seed: number;
  /** 半荘終了日時(epoch ミリ秒)。 */
  readonly finishedAt: number;
  /** 4兄弟全員の確定内訳。 */
  readonly players: readonly MatchHistoryPlayer[];
}

/** 4兄弟の人数(保存レコードの `players` 長の不変条件)。 */
const PLAYER_COUNT = 4;
/** 想定外に長い名前(改竄・破損)を拒否する上限。既定名は2文字。 */
const MAX_NAME_LENGTH = 32;

function isPlayer(value: unknown): value is MatchHistoryPlayer {
  if (!value || typeof value !== "object") return false;
  const player = value as Record<string, unknown>;
  return (
    hasOnlyKeys(player, [
      "name",
      "rank",
      "rawScore",
      "uma",
      "bonus",
      "soshiiTotal",
    ]) &&
    typeof player.name === "string" &&
    player.name.length > 0 &&
    player.name.length <= MAX_NAME_LENGTH &&
    Number.isInteger(player.rank) &&
    Number(player.rank) >= 1 &&
    Number(player.rank) <= PLAYER_COUNT &&
    Number.isSafeInteger(player.rawScore) &&
    Number.isSafeInteger(player.uma) &&
    Number.isSafeInteger(player.bonus) &&
    Number.isSafeInteger(player.soshiiTotal)
  );
}

function isEntry(value: unknown): value is MatchHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  if (
    !hasOnlyKeys(entry, ["seed", "finishedAt", "players"]) ||
    !Number.isSafeInteger(entry.seed) ||
    Number(entry.seed) < 0 ||
    Number(entry.seed) > 0xffffffff ||
    !Number.isSafeInteger(entry.finishedAt) ||
    Number(entry.finishedAt) < 0 ||
    !Array.isArray(entry.players) ||
    entry.players.length !== PLAYER_COUNT ||
    !entry.players.every(isPlayer)
  ) {
    return false;
  }
  // 順位は 1〜4 が重複なく揃う(engine の厳密順位決定 Q19/Q20 の不変条件)。
  const ranks = new Set(entry.players.map((p) => p.rank));
  return ranks.size === PLAYER_COUNT;
}

/** 保存文字列を検証付きで戦績配列(新しい順)へ復元する。破損時は null。 */
export function parseHistory(raw: string): readonly MatchHistoryEntry[] | null {
  if (raw.length * 2 > MAX_HISTORY_BYTES) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      !value ||
      typeof value !== "object" ||
      !hasOnlyKeys(value, ["version", "entries"]) ||
      value.version !== VERSION ||
      !Array.isArray(value.entries) ||
      value.entries.length > MAX_HISTORY_ENTRIES ||
      !value.entries.every(isEntry)
    ) {
      return null;
    }
    return value.entries as readonly MatchHistoryEntry[];
  } catch {
    return null;
  }
}

/**
 * 保存済み戦績(新しい順)を読み込む。未保存・破損・読み込み不可は空配列。
 * 破損データはジャーナルと同様、次回以降のために削除しておく。
 */
export function loadHistory(storage: Storage): readonly MatchHistoryEntry[] {
  try {
    const raw = storage.getItem(MATCH_HISTORY_KEY);
    if (raw === null) return [];
    const entries = parseHistory(raw);
    if (entries === null) {
      storage.removeItem(MATCH_HISTORY_KEY);
      return [];
    }
    return entries;
  } catch {
    return [];
  }
}

function save(storage: Storage, entries: readonly MatchHistoryEntry[]): void {
  storage.setItem(
    MATCH_HISTORY_KEY,
    JSON.stringify({ version: VERSION, entries }),
  );
}

/**
 * 半荘結果を戦績の先頭(最新)へ追記する。
 *
 * - 同一 seed の記録が既にあれば何もしない(終局済みジャーナルのリロード再生対策)。
 * - `MAX_HISTORY_ENTRIES` を超える分は最古から破棄する。
 * - 保存容量が不足した場合は今回の1件のみで再試行し、最新結果の保存を優先する。
 *   それでも保存できない環境では諦める(対局自体は継続できる)。
 */
export function appendHistory(
  storage: Storage,
  entry: MatchHistoryEntry,
): void {
  try {
    const entries = loadHistory(storage);
    if (entries.some((existing) => existing.seed === entry.seed)) return;
    const next = [entry, ...entries].slice(0, MAX_HISTORY_ENTRIES);
    try {
      save(storage, next);
    } catch {
      save(storage, [entry]);
    }
  } catch {
    // 保存不可でも対局・画面表示は継続する。
  }
}

/** 保存済み戦績をすべて消去する。 */
export function clearHistory(storage: Storage): void {
  try {
    storage.removeItem(MATCH_HISTORY_KEY);
  } catch {
    // 消去不可(Storage 無効等)は黙って無視する。
  }
}

/**
 * `localStorage` を安全に取得する。SSR・Storage 無効環境(SecurityError)では null。
 * 戦績はプログレッシブエンハンスメント: 保存できない環境でも対局は成立する。
 */
export function localStorageOrNull(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
