/**
 * Shared display-name policy for settings and online rooms.
 *
 * The limit is measured in grapheme clusters rather than UTF-16 code units so
 * that emoji, combining characters, and ZWJ sequences count as one visible
 * character. Malformed UTF-16 is repaired before segmentation so a boundary
 * never returns a lone surrogate.
 */

/** 1人あたりの表示名の最大書記素クラスタ数。 */
export const MAX_PLAYER_NAME_LENGTH = 12;

/**
 * 書記素分割にかける入力の UTF-16 code unit 上限。
 *
 * `Intl.Segmenter` は入力長に比例したコストを払うので、数MBの貼り付けや改竄された
 * 入力をそのまま渡すと分割だけで描画・接続処理が止まる。1書記素は ZWJ列や tag
 * sequence でも十数 code unit に収まるため、上限の32倍あれば正規の名前は必ず通る。
 */
export const MAX_PLAYER_NAME_CODE_UNITS = MAX_PLAYER_NAME_LENGTH * 32;

/**
 * 表示名へ持ち込ませない不可視の書式制御文字。
 *
 * `Cf` を一括で除去すると、絵文字の ZWJ・正規のRTL表記に使うZWNJ・emoji tag
 * sequenceまで壊してしまうため、表示に意味のある列の構成要素だけを保持する。
 * `Bidi_Control` (LRM/RLM、embedding/override、isolate等)や U+200B/U+2060/U+FEFF は
 * 保持対象外である。
 */
const PLAYER_NAME_FORMAT = /\p{Cf}/u;
const PRESERVED_PLAYER_NAME_FORMAT =
  /(?:[\u200C\u200D]|\u{E0001}|[\u{E0020}-\u{E007F}])/u;
const NON_RENDERING_PLAYER_NAME_POINT =
  /(?:\p{Mark}|\p{White_Space}|\p{Cf}|[\uFE0E\uFE0F\u{E0100}-\u{E01EF}])/u;

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

/** 表示名へ混入した bidi/invisible format control の有無を判定する。 */
export function hasDisallowedPlayerNameControls(value: string): boolean {
  return [...toWellFormed(value)].some(
    (point) =>
      PLAYER_NAME_FORMAT.test(point) &&
      !PRESERVED_PLAYER_NAME_FORMAT.test(point),
  );
}

/** lone surrogate を含まない名前か判定する。 */
export function isWellFormedPlayerName(value: string): boolean {
  return toWellFormed(value) === value;
}

function stripDisallowedPlayerNameControls(value: string): string {
  return [...toWellFormed(value)]
    .filter(
      (point) =>
        !(
          PLAYER_NAME_FORMAT.test(point) &&
          !PRESERVED_PLAYER_NAME_FORMAT.test(point)
        ),
    )
    .join("");
}

function hasVisiblePlayerNameBase(value: string): boolean {
  return [...toWellFormed(value)].some(
    (point) => !NON_RENDERING_PLAYER_NAME_POINT.test(point),
  );
}

const isRegionalIndicator = (value: string) =>
  /[\u{1F1E6}-\u{1F1FF}]/u.test(value);
const extendsPreviousGrapheme = (value: string) =>
  /\p{Mark}/u.test(value) ||
  /[\uFE0E\uFE0F]/u.test(value) ||
  /[\u{1F3FB}-\u{1F3FF}]/u.test(value);

/**
 * `Intl.Segmenter` 非対応環境向けの決定的 fallback。
 *
 * 表示名の切り詰め(UAX#29 の近似)に必要な範囲だけを扱う ─ 結合文字(`\p{Mark}`)、
 * variation selector、emoji modifier(skin tone)、ZWJ列、国旗(regional indicator)ペア。
 *
 * 次は UAX#29 と一致しない: tag sequence の地域旗(🏴󠁧󠁢󠁥󠁮󠁧󠁿)、分解ハングル(L+V+T)、
 * CRLF、Indic の virama 合字、タイ語 SARA AM、ZWNJ。いずれも過剰分割side(1書記素を
 * 複数と数える)なので上限が厳しくなるだけで、サロゲート分断は起きない。
 * `Intl.Segmenter` は2020年以降の全ブラウザにあり本経路は実質到達しないため、
 * 完全な UAX#29 実装は持たない。**汎用の書記素分割としては転用しないこと。**
 */
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
 * 入力中・保存時・オンライン接続時で共用する、書記素クラスタ単位の上限適用。
 *
 * `playerNameGraphemes` が先に well-formed 化するため、戻り値に lone surrogate は残らない。
 */
export function limitPlayerName(value: string): string {
  // 先頭12書記素しか使わないので、巨大な貼り付けは分割前に code unit で切り落とす。
  const safeValue = stripDisallowedPlayerNameControls(
    value.slice(0, MAX_PLAYER_NAME_CODE_UNITS),
  );
  if (!hasVisiblePlayerNameBase(safeValue)) return "";
  return playerNameGraphemes(safeValue)
    .slice(0, MAX_PLAYER_NAME_LENGTH)
    .join("");
}

/** 保存・表示境界で使う名前の妥当性を検証する。 */
export function isValidPlayerName(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_PLAYER_NAME_CODE_UNITS &&
    !hasDisallowedPlayerNameControls(value) &&
    hasVisiblePlayerNameBase(value) &&
    playerNameGraphemes(value).length <= MAX_PLAYER_NAME_LENGTH
  );
}

/** 1件の入力値を保存・表示可能な形へ正規化する。空欄は `null` を返す。 */
export function sanitizePlayerName(raw: string): string | null {
  const normalized = stripDisallowedPlayerNameControls(raw)
    .replace(/\s+/gu, " ")
    .trim();
  if (normalized === "" || !hasVisiblePlayerNameBase(normalized)) return null;
  return limitPlayerName(normalized);
}
