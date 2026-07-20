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
import { localStorageOrNull } from "@/components/common/browserStorage";
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
/**
 * 想定外に長い名前(改竄・破損)を拒否する上限。
 * ユーザー設定の上限は12文字(`MAX_PLAYER_NAME_LENGTH` / #291)なので、
 * 正規の名前は必ず収まる。ここは防御用に余裕を持たせた値。
 */
const MAX_NAME_LENGTH = 32;
/**
 * `Date` が表現できる epoch ミリ秒の上限(±8.64e15)。
 * `Number.isSafeInteger` だけでは 2^53-1 まで通ってしまい、`new Date()` が
 * Invalid Date になって `Intl.DateTimeFormat.format` が `RangeError` を投げる。
 * 壊れた1件で戦績ページ全体が描画不能になるため、読み込み時点で弾く。
 */
const MAX_TIMESTAMP = 8_640_000_000_000_000;

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
    Number(entry.finishedAt) > MAX_TIMESTAMP ||
    !Array.isArray(entry.players) ||
    entry.players.length !== PLAYER_COUNT ||
    !entry.players.every(isPlayer)
  ) {
    return false;
  }
  // 順位は 1〜4 が重複なく揃う(engine の厳密順位決定 Q19/Q20 の不変条件)。
  const ranks = new Set(entry.players.map((p) => p.rank));
  if (ranks.size !== PLAYER_COUNT) return false;
  // 名前の一意性は**検証しない**。対局者名はユーザーが自由に設定でき(issue #291 /
  // スペック6 6.2.1)、4人に同じ名前を付けることを禁止していないため。表示側の
  // React key には名前ではなく一意性を検証済みの rank を使う。
  // ソシー合計は内訳の総和と一致する(engine の不変条件: engine.test.ts)。
  return entry.players.every(
    (p) => p.rawScore + p.uma + p.bonus === p.soshiiTotal,
  );
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
 * - 保存前に読み込みと同じ検証をかけ、`parseHistory` が受理できない値は書き込まない。
 *   書き込めてしまうと次回読み込みで全体が破損扱いになり、過去の記録ごと消える
 *   (`?seed=` で uint32 超の seed を与えた非production対局などが実際に該当する)。
 * - 同一 seed の記録が既にあれば何もしない(終局済みジャーナルのリロード再生対策)。
 * - `MAX_HISTORY_ENTRIES` を超える分は最古から破棄する。
 * - 保存容量が不足した場合は件数を半減させながら再試行し、**保存できる範囲の履歴を
 *   最大限残す**(最新結果を最優先しつつ、過去の記録を不必要に全消ししない)。
 *   1件でも保存できない環境では諦める(対局自体は継続できる)。
 */
export function appendHistory(
  storage: Storage,
  entry: MatchHistoryEntry,
): void {
  if (!isEntry(entry)) return;
  try {
    const entries = loadHistory(storage);
    if (entries.some((existing) => existing.seed === entry.seed)) return;
    let next = [entry, ...entries].slice(0, MAX_HISTORY_ENTRIES);
    // 半減で切り詰めるため試行回数は log2(MAX_HISTORY_ENTRIES) 程度に収まる。
    for (;;) {
      try {
        save(storage, next);
        return;
      } catch {
        if (next.length <= 1) return;
        next = next.slice(0, Math.max(1, Math.floor(next.length / 2)));
      }
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
  } finally {
    notifySubscribers();
  }
}

// ---------------------------------------------------------------------------
// 外部ストア購読(`useSyncExternalStore` 用) — issue #302
//
// `localStorage` は React の外にある可変ストアなので、描画中(`useMemo`)に読むのでは
// なく `useSyncExternalStore` で購読する(`playerNames.ts` / `ThemeToggle` と同じ方式)。
//
// `getSnapshot` は React が「いつ・何度呼んでもよい」純粋関数でなければならないため、
// **破損データの削除(`loadHistory` の `removeItem`)は行わない**。削除は描画後に走る
// `subscribe`(= `useSyncExternalStore` の効果)側の責務とする。
// ---------------------------------------------------------------------------

const subscribers = new Set<() => void>();
/** 空の結果は常に同一参照で返す(`getSnapshot` の参照安定性 = 無限再描画の防止)。 */
const EMPTY_HISTORY: readonly MatchHistoryEntry[] = Object.freeze([]);
/** 直近に解析した保存文字列と、その解析結果(同値なら同一参照を返すためのキャッシュ)。 */
let cachedRaw: string | null = null;
let cachedEntries: readonly MatchHistoryEntry[] = EMPTY_HISTORY;

function notifySubscribers(): void {
  for (const callback of subscribers) callback();
}

/**
 * `localStorage` の変更(このタブの保存・削除、別タブの `storage` イベント)を購読する。
 *
 * 購読開始時に一度だけ `loadHistory` を通し、破損データが残っていれば次回以降のために
 * 削除する(描画中ではなく効果として実行される)。
 */
export function subscribeHistory(callback: () => void): () => void {
  subscribers.add(callback);
  const storage = localStorageOrNull();
  if (storage !== null) loadHistory(storage);
  const onStorage = (event: StorageEvent) => {
    if (event.key === MATCH_HISTORY_KEY || event.key === null) {
      notifySubscribers();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    subscribers.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * 現在の保存値(新しい順)。副作用を持たず、値が変わらない限り同一参照を返す。
 * 未保存・破損・読み込み不可はいずれも空配列(破損データの削除は `subscribeHistory`)。
 */
export function getHistorySnapshot(): readonly MatchHistoryEntry[] {
  let raw: string | null;
  try {
    raw = localStorageOrNull()?.getItem(MATCH_HISTORY_KEY) ?? null;
  } catch {
    raw = null;
  }
  if (raw === null) {
    cachedRaw = null;
    cachedEntries = EMPTY_HISTORY;
    return EMPTY_HISTORY;
  }
  if (raw === cachedRaw) return cachedEntries;
  cachedRaw = raw;
  cachedEntries = parseHistory(raw) ?? EMPTY_HISTORY;
  return cachedEntries;
}

/**
 * サーバー描画・初回ハイドレーション時のスナップショット。
 *
 * `localStorage` はサーバーでは読めないため `null`(= 読み込み中)を返し、
 * ハイドレーション後に実値へ切り替える(`ResultPageClient` と同じマウントゲート)。
 */
export function getServerHistorySnapshot(): null {
  return null;
}
