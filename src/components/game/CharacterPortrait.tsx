import Image from "next/image";
import type { CSSProperties } from "react";
import { characterProfile } from "@/domain/game/characters";
import type { PlayerId } from "@/domain/game/engine";

export interface CharacterPortraitProps {
  readonly playerId: PlayerId;
  readonly size?: "small" | "medium";
}

/** profileの識別色をCSS tokenへ結線する。各画面でID→色の対応を重複定義しない。 */
export function characterAccentStyle(playerId: PlayerId): CSSProperties {
  const { theme } = characterProfile(playerId);
  return { "--character-accent": `var(--character-${theme})` } as CSSProperties;
}

/** 名前が隣接するUI用の装飾ポートレート。人物名の重複読み上げを避けて alt は空にする。 */
export default function CharacterPortrait({
  playerId,
  size = "small",
}: CharacterPortraitProps) {
  const profile = characterProfile(playerId);
  return (
    <span
      aria-hidden="true"
      data-character-id={playerId}
      style={characterAccentStyle(playerId)}
      className={`character-portrait relative inline-flex shrink-0 overflow-hidden rounded-md ${
        size === "medium" ? "h-16 w-12" : "h-11 w-9"
      }`}
    >
      <Image
        unoptimized
        src={profile.portraitSrc}
        alt=""
        width={220}
        height={420}
        className="h-full w-full object-cover object-top"
      />
    </span>
  );
}
