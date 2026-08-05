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
 * 実在人物名は既定値にもプレースホルダにも**埋め込まない**。本作は非公式ファンメイドであり、
 * 番組メンバー名を出荷物へ同梱するかは未確定(`質問リスト.md` Q28)のため、案内は
 * 「四人回しの4人を設定できる」という汎用文言に留め、実名の入力はユーザーに委ねる。
 */

import { localStorageOrNull } from "@/components/common/browserStorage";
import { DEFAULT_NAMES, type PlayerNames } from "@/domain/game/engine";

export type { PlayerNames };

/** `localStorage` の保存キー。スキーマ変更時は末尾の版番号を上げる。 */
export const PLAYER_NAMES_STORAGE_KEY = "four-bros-mahjong.playerNames.v1";

/**
 * 1人あたりの名前の最大文字数。
 *
 * 盤面の各家ラベルは横幅の狭いモバイル(スペック5 5.3 の最小ブレークポイント)にも
 * 収める必要があるため、レイアウト崩れと保存量肥大の双方を防ぐ上限として設ける。
 */
export const MAX_PLAYER_NAME_LENGTH = 12;

/** 不正な UTF-16 を U+FFFD へ置換し、サロゲートペアを分断しない文字列にする。 */
function toWellFormed(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index++) {
    const first = value.charCodeAt(index);
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(index + 1);
      if (second >= 0xdc00 && second <= 0xdfff) {
        result += value[index] + value[index + 1];
        index++;
      } else result += "\uFFFD";
    } else if (first >= 0xdc00 && first <= 0xdfff) result += "\uFFFD";
    else result += value[index];
  }
  return result;
}

const isRegionalIndicator = (value: string) =>
  /[\u{1F1E6}-\u{1F1FF}]/u.test(value);
const extendsPreviousGrapheme = (value: string) =>
  /\p{Mark}/u.test(value) ||
  /[\uFE0E\uFE0F]/u.test(value) ||
  /[\u{1F3FB}-\u{1F3FF}]/u.test(value);

/** `Intl.Segmenter` 非対応環境向けの決定的 fallback。 */
function fallbackGraphemes(value: string): string[] {
  const result: string[] = [];
  for (const point of value) {
    const previous = result.at(-1);
    if (
      previous !== undefined &&
      (extendsPreviousGrapheme(point) ||
        point === "\u200D" ||
        previous.endsWith("\u200D") ||
        (isRegionalIndicator(point) &&
          isRegionalIndicator(previous) &&
          [...previous].length === 1))
    ) {
      result[result.length - 1] += point;
    } else result.push(point);
  }
  return result;
}

/** ユーザーが認識する書記素クラスタへ分割する。 */
export function playerNameGraphemes(value: string): string[] {
  const wellFormed = toWellFormed(value);
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("ja", { granularity: "grapheme" });
    return [...segmenter.segment(wellFormed)].map(({ segment }) => segment);
  }
  return fallbackGraphemes(wellFormed);
}

/**
 * 入力中・保存時で共用する、書記素クラスタ単位の上限適用。
 *
 * `playerNameGraphemes` が先に well-formed 化するため、戻り値に lone surrogate は残らない
 * (#484 修正前の code unit 切り詰めが残した半端なサロゲートは U+FFFD へ寄せられる)。
 */
export function limitPlayerName(value: string): string {
  return playerNameGraphemes(value).slice(0, MAX_PLAYER_NAME_LENGTH).join("");
}

/**
 * 永続化境界(`sessionStorage` の対局ジャーナル)で用いる名前の検証。
 *
 * 見るのは「非空」と「書記素クラスタが上限以下」の2点だけで、**lone surrogate は拒否しない**。
 * #484 の修正前は UTF-16 code unit で切り詰めていたため、既存の保存値には末尾が半端な
 * サロゲートになったもの(例: `"12345678901😀"` → `"12345678901\uD83D"`)が実在し得る。
 * これを不正として弾くと、#484 に当たったユーザーだけが進行中の半荘を失う。
 * 表示名は Wall/RNG・操作列の再生結果に影響しないので、拒否ではなく読み込み側で
 * `limitPlayerName` により U+FFFD へ正規化して受け入れる(v1→v2 移行と同じ方針)。
 */
export function isValidPlayerName(value: string): boolean {
  return (
    value.length > 0 &&
    playerNameGraphemes(value).length <= MAX_PLAYER_NAME_LENGTH
  );
}

/** 入力欄のラベル(index 0 = 自家)。 */
export const PLAYER_NAME_LABELS: readonly [string, string, string, string] = [
  "あなた(自家)",
  "対局者2",
  "対局者3",
  "対局者4",
];

export { DEFAULT_NAMES };

/**
 * 1件の入力値を保存・表示可能な形へ正規化する。
 *
 * - 前後の空白を落とし、連続する空白類(改行・タブを含む)は半角スペース1つへ畳む。
 *   `localStorage` 由来の文字列が改行を含むと各家ラベルの1行表示が崩れるため。
 * - 上限文字数で切り詰める。
 * - 実質空(空文字/空白のみ)は `null` を返し、呼び出し側で既定名へフォールバックさせる。
 */
export function sanitizePlayerName(raw: string): string | null {
  const normalized = raw.replace(/\s+/gu, " ").trim();
  if (normalized === "") return null;
  return limitPlayerName(normalized);
}

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
