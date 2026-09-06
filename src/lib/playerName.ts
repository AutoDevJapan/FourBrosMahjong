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
 * 表示名へ持ち込ませない制御文字。
 *
 * `Cc` は非空白を含めて除去する。`Cf` を一括で除去すると、絵文字の ZWJ・正規の
 * RTL表記に使うZWNJ・emoji tag sequenceまで壊してしまうため、表示に意味のある
 * 列の構成要素だけを保持する。`Bidi_Control` (LRM/RLM、embedding/override、
 * isolate等)や U+200B/U+2060/U+FEFF は保持対象外である。
 */
const PLAYER_NAME_CONTROL = /\p{Cc}/u;
const PLAYER_NAME_FORMAT = /\p{Cf}/u;
const PRESERVED_PLAYER_NAME_FORMAT =
  /(?:[\u200C\u200D]|\u{E0001}|[\u{E0020}-\u{E007F}])/u;
const NON_RENDERING_PLAYER_NAME_POINT =
  /(?:\p{Cc}|\p{Mark}|\p{White_Space}|\p{Cf}|[\uFE0E\uFE0F\u{E0100}-\u{E01EF}])/u;

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
      PLAYER_NAME_CONTROL.test(point) ||
      (PLAYER_NAME_FORMAT.test(point) &&
        !PRESERVED_PLAYER_NAME_FORMAT.test(point)),
  );
}

/** lone surrogate を含まない名前か判定する。 */
export function isWellFormedPlayerName(value: string): boolean {
  return toWellFormed(value) === value;
}

function stripDisallowedPlayerNameControls(value: string): string {
  return [...toWellFormed(value)]
    .map((point) => {
      // Keep the existing whitespace normalization behavior for pasted line
      // breaks/tabs while dropping non-whitespace C0/C1 controls entirely.
      if (PLAYER_NAME_CONTROL.test(point)) {
        return /\s/u.test(point) ? " " : "";
      }
      if (
        PLAYER_NAME_FORMAT.test(point) &&
        !PRESERVED_PLAYER_NAME_FORMAT.test(point)
      ) {
        return "";
      }
      return point;
    })
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

type SegmenterLike = {
  segment: (value: string) => Iterable<{ readonly segment: string }>;
};

type SegmenterConstructor = new (
  locales?: string | string[],
  options?: { readonly granularity?: "grapheme" | "word" | "sentence" },
) => SegmenterLike;

/** Intl.Segmenter is optional and may be exposed by a host that rejects use. */
function intlGraphemes(value: string): string[] | null {
  try {
    const intl = typeof Intl === "undefined" ? undefined : Intl;
    const Segmenter = (intl as { Segmenter?: SegmenterConstructor } | undefined)
      ?.Segmenter;
    if (typeof Segmenter !== "function") return null;

    const segmenter = new Segmenter("ja", { granularity: "grapheme" });
    return [...segmenter.segment(value)].map(({ segment }) => segment);
  } catch {
    // A restricted host can reject the getter, constructor, or segment call.
    return null;
  }
}

/** ユーザーが認識する書記素クラスタへ分割する。 */
export function playerNameGraphemes(value: string): string[] {
  const wellFormed = toWellFormed(value);
  return intlGraphemes(wellFormed) ?? fallbackGraphemes(wellFormed);
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

/**
 * IME変換中の候補を、書記素の上限を適用せずに安全な長さへ切り詰める。
 *
 * 変換中は読みや候補を途中で分割するとIMEの確定状態を壊すため、
 * limitPlayerNameの書記素上限をまだ適用できない。一方、変換イベントの値を
 * 無制限にstateへ保持すると、確定前の巨大な貼り付けや自動入力が各renderへ
 * 流れ込む。code unitだけを先に制限し、境界でサロゲートを分断しない形へ
 * 正規化することで、候補を保ったまま後続処理の計算量を固定する。
 */
export function boundPlayerNameInput(value: string): string {
  return toWellFormed(value.slice(0, MAX_PLAYER_NAME_CODE_UNITS));
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
  const limited = limitPlayerName(normalized);
  return hasVisiblePlayerNameBase(limited) ? limited : null;
}
