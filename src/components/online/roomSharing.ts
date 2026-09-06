import { normalizeRoomCode } from "@/lib/roomCode";

/** ルームコードを参加フォームへ引き継ぐ共有リンクを作る。 */
export function roomShareUrl(code: string): string {
  const normalized = normalizeRoomCode(code);
  const path =
    normalized === null
      ? "/online"
      : `/online?room=${encodeURIComponent(normalized)}`;
  if (typeof window === "undefined") return path;
  try {
    // Sandboxed documents have an opaque `null` origin, and embedded hosts may
    // expose a location object whose accessors reject reads. Sharing remains
    // useful with the relative path even when an absolute URL is unavailable.
    return new URL(path, window.location.origin).toString();
  } catch {
    return path;
  }
}

/** 現在のURLに含まれる有効な共有ルームコードだけを取り出す。 */
export function readSharedRoomCode(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const value = new URL(window.location.href).searchParams.get("room");
    return normalizeRoomCode(value);
  } catch {
    // A restricted or opaque location must not make lobby restoration fail.
    return null;
  }
}
