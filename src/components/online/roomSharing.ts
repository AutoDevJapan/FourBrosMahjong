import { normalizeRoomCode } from "@/lib/roomCode";

/** ルームコードを参加フォームへ引き継ぐ共有リンクを作る。 */
export function roomShareUrl(code: string): string {
  const normalized = normalizeRoomCode(code);
  const path =
    normalized === null
      ? "/online"
      : `/online?room=${encodeURIComponent(normalized)}`;
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).toString();
}

/** 現在のURLに含まれる有効な共有ルームコードだけを取り出す。 */
export function readSharedRoomCode(): string | null {
  if (typeof window === "undefined") return null;

  const value = new URL(window.location.href).searchParams.get("room");
  return normalizeRoomCode(value);
}
