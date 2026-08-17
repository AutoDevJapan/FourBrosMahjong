export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const ROOM_CODE_CHARACTER_CLASS = `[${ROOM_CODE_ALPHABET}]`;

/** 生成されるコードと、参加前に受け付けるコードの形式を共有する。 */
export const ROOM_CODE_PATTERN = new RegExp(
  `^${ROOM_CODE_CHARACTER_CLASS}{${ROOM_CODE_LENGTH}}$`,
);
export const ROOM_CODE_CHARACTER_PATTERN = new RegExp(
  `^${ROOM_CODE_CHARACTER_CLASS}*$`,
);
export const ROOM_CODE_FORMAT_MESSAGE =
  "ルームコードは英大文字と2〜9の数字を使った6文字で入力してください。I/O/0/1は使用しません。";

/** 外部入力を、生成側と同じ大文字のルームコードへ正規化する。 */
export function normalizeRoomCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return ROOM_CODE_PATTERN.test(code) ? code : null;
}
