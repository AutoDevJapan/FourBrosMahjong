/**
 * 履歴の終了日時表示。
 *
 * `Intl.DateTimeFormat` の `dateStyle` / `timeStyle` は古いWebViewや制限された
 * Intl実装ではconstructorまたはformat時に例外を投げることがある。履歴画面の
 * 表示補助がモジュール評価や描画全体を壊さないよう、formatterは能力境界の内側で
 * 作成し、利用できない場合は標準のDate getterによる簡潔なローカル表示へ退避する。
 */

type DateTimeFormatter = {
  format: (value: Date) => string;
};

type DateTimeFormatterConstructor = new (
  locales?: string | string[],
  options?: Intl.DateTimeFormatOptions,
) => DateTimeFormatter;

export type IntlDateTimeLike = {
  readonly DateTimeFormat?: DateTimeFormatterConstructor;
};

const FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short",
};

/** 対応環境では現行のja-JP表示formatterを返し、能力失敗時はnullを返す。 */
export function createFinishedAtFormatter(
  intl: IntlDateTimeLike | undefined = typeof Intl === "undefined"
    ? undefined
    : Intl,
): DateTimeFormatter | null {
  try {
    const constructor = intl?.DateTimeFormat;
    if (typeof constructor !== "function") return null;
    const formatter = new constructor("ja-JP", FORMAT_OPTIONS);
    return typeof formatter.format === "function" ? formatter : null;
  } catch {
    return null;
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatFallback(date: Date): string {
  if (!Number.isFinite(date.getTime())) return "日時不明";
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Intlが利用できない場合も履歴1件の表示を継続する。 */
export function formatFinishedAt(
  timestamp: number,
  formatter: DateTimeFormatter | null = createFinishedAtFormatter(),
): string {
  const date = new Date(timestamp);
  try {
    if (formatter !== null) return formatter.format(date);
  } catch {
    // A formatter can become unusable after construction in a restricted host.
  }
  return formatFallback(date);
}
