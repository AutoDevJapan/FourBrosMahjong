const ROOM_CODE_PATTERN = /^[A-Z2-9]{6}$/;

/** ルームコードを参加フォームへ引き継ぐ共有リンクを作る。 */
export function roomShareUrl(code: string): string {
  const path = `/online?room=${encodeURIComponent(code)}`;
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

/** 現在のURLに含まれる有効な共有ルームコードだけを取り出す。 */
export function readSharedRoomCode(): string | null {
  if (typeof window === "undefined") return null;

  const value = new URL(window.location.href).searchParams.get("room");
  const normalized = value?.trim().toUpperCase() ?? "";
  return ROOM_CODE_PATTERN.test(normalized) ? normalized : null;
}
