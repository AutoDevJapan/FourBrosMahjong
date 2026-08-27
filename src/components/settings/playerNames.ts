/**
 * 対局者名(四人回しの4人)の設定と永続化(issue #291)。
 *
 * `/settings` で入力した4人の表示名を `localStorage` に保存し、対局開始時に
 * `createGame({ names })` へ渡す。engine が `EnginePlayer.name` として保持するため、
 * 盤面(`PlayerArea` / `BenchArea`)・結果画面(`RankingTable` / `SoshiiBreakdown`)・
 * 読み上げ(`LiveRegion`)へは既存の `selectView` 経由で自動的に反映される。
 *
 * 保存範囲は同一ブラウザの `localStorage` のみで、バックエンド/複数デバイス同期は行わない
 * (`documents/spec/screen-design-and-routing.md` 6.2 の `/settings` 責務に沿う)。
 *
 * 既定値はオーナー指定のもじり名(issue #711)。保存済みカスタム名は同じstorage keyから
 * そのまま読み、新しい既定値で上書きしない。
 */

import { localStorageOrNull } from "@/components/common/browserStorage";
import { CHARACTER_PROFILES } from "@/domain/game/characters";
import { DEFAULT_NAMES, type PlayerNames } from "@/domain/game/engine";
import { sanitizePlayerName } from "@/lib/playerName";

export {
  isValidPlayerName,
  limitPlayerName,
  MAX_PLAYER_NAME_CODE_UNITS,
  MAX_PLAYER_NAME_LENGTH,
  playerNameGraphemes,
  sanitizePlayerName,
} from "@/lib/playerName";

export type { PlayerNames };

/** `localStorage` の保存キー。スキーマ変更時は末尾の版番号を上げる。 */
export const PLAYER_NAMES_STORAGE_KEY = "four-bros-mahjong.playerNames.v1";

/** 入力欄のラベル。固定席を示さず、キャラクターSSOTのp0-p3順を使う。 */
export const PLAYER_NAME_LABELS: readonly [string, string, string, string] = [
  CHARACTER_PROFILES.p0.defaultName,
  CHARACTER_PROFILES.p1.defaultName,
  CHARACTER_PROFILES.p2.defaultName,
  CHARACTER_PROFILES.p3.defaultName,
];

export { DEFAULT_NAMES };

/** 4件の入力値を正規化し、空欄は既定名で埋めた確定名を返す。 */
export function resolvePlayerNames(
  raw: readonly [string, string, string, string],
): PlayerNames {
  return [
    sanitizePlayerName(raw[0]) ?? DEFAULT_NAMES[0],
    sanitizePlayerName(raw[1]) ?? DEFAULT_NAMES[1],
    sanitizePlayerName(raw[2]) ?? DEFAULT_NAMES[2],
    sanitizePlayerName(raw[3]) ?? DEFAULT_NAMES[3],
  ];
}

/**
 * 保存文字列を解析する。想定外の形(旧版・手書き改変・型不一致)は `null` を返し、
 * 呼び出し側で既定名へフォールバックさせる(後方互換: 未設定時は従来どおり既定名)。
 */
export function parsePlayerNames(raw: string): PlayerNames | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length !== DEFAULT_NAMES.length) {
      return null;
    }
    if (!value.every((name) => typeof name === "string")) return null;
    return resolvePlayerNames(
      value as unknown as [string, string, string, string],
    );
  } catch {
    return null;
  }
}

/** 保存済みの対局者名を読む。未設定・破損・`localStorage` 不可時は既定名。 */
export function loadPlayerNames(storage: Storage): PlayerNames {
  try {
    const raw = storage.getItem(PLAYER_NAMES_STORAGE_KEY);
    if (raw === null) return DEFAULT_NAMES;
    return parsePlayerNames(raw) ?? DEFAULT_NAMES;
  } catch {
    return DEFAULT_NAMES;
  }
}

/**
 * 対局者名を保存する。保存できたかを返す(容量超過・プライベートモード等では `false`)。
 * 保存不可でも呼び出し側の現在セッションは継続できるよう、例外は投げない。
 */
export function savePlayerNames(storage: Storage, names: PlayerNames): boolean {
  try {
    storage.setItem(PLAYER_NAMES_STORAGE_KEY, JSON.stringify(names));
    notifySubscribers();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 外部ストア購読(`useSyncExternalStore` 用)
//
// `localStorage` は React の外にある可変ストアなので、`useEffect` + `setState` で
// 読み込むのではなく `useSyncExternalStore` で購読する(`ThemeToggle` と同じ方式)。
// これによりサーバー描画と初回クライアント描画が既定名で一致し、ハイドレーション後に
// 実値へ同期される。別タブでの保存も `storage` イベントで取り込む。
// ---------------------------------------------------------------------------

const subscribers = new Set<() => void>();
// `getSnapshot` は同値なら同一参照を返す必要がある(無限再レンダー防止)。
let cachedSnapshot: PlayerNames = DEFAULT_NAMES;

function notifySubscribers(): void {
  cachedSnapshot = DEFAULT_NAMES;
  for (const callback of subscribers) callback();
}

/** `localStorage` の変更(このタブの保存・別タブの `storage` イベント)を購読する。 */
export function subscribePlayerNames(callback: () => void): () => void {
  subscribers.add(callback);
  const onStorage = (event: StorageEvent) => {
    if (event.key === PLAYER_NAMES_STORAGE_KEY || event.key === null) {
      notifySubscribers();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    subscribers.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}

/** 現在の保存値。値が変わらない限り同一参照を返す。 */
export function getPlayerNamesSnapshot(): PlayerNames {
  const storage = localStorageOrNull();
  const names = storage === null ? DEFAULT_NAMES : loadPlayerNames(storage);
  if (names.every((name, index) => cachedSnapshot[index] === name)) {
    return cachedSnapshot;
  }
  cachedSnapshot = names;
  return cachedSnapshot;
}

/** サーバー描画時の固定スナップショット(未設定 = 既定名)。 */
export function getServerPlayerNamesSnapshot(): PlayerNames {
  return DEFAULT_NAMES;
}
