/** 四兄弟の固定キャラクター情報(issue #711)の唯一の定義元。 */

export type CharacterPlayerId = "p0" | "p1" | "p2" | "p3";
export type CharacterPlayerNames = readonly [string, string, string, string];

type CharacterTheme = "red" | "blue" | "yellow" | "green";

export interface CharacterProfile {
  readonly playerId: CharacterPlayerId;
  readonly defaultName: string;
  readonly theme: CharacterTheme;
  readonly portraitSrc: string;
}

export const CHARACTER_PROFILES = {
  p0: {
    playerId: "p0",
    defaultName: "粗悪品",
    theme: "red",
    portraitSrc: "/characters/p0-soakuhin-portrait.avif",
  },
  p1: {
    playerId: "p1",
    defaultName: "竜二",
    theme: "blue",
    portraitSrc: "/characters/p1-ryuji-portrait.avif",
  },
  p2: {
    playerId: "p2",
    defaultName: "マサキ",
    theme: "yellow",
    portraitSrc: "/characters/p2-masaki-portrait.avif",
  },
  p3: {
    playerId: "p3",
    defaultName: "糸瓜",
    theme: "green",
    portraitSrc: "/characters/p3-hechima-portrait.avif",
  },
} as const satisfies Readonly<Record<CharacterPlayerId, CharacterProfile>>;

export const CHARACTER_PLAYER_IDS = ["p0", "p1", "p2", "p3"] as const;

export const CHARACTER_DEFAULT_NAMES: CharacterPlayerNames = [
  CHARACTER_PROFILES.p0.defaultName,
  CHARACTER_PROFILES.p1.defaultName,
  CHARACTER_PROFILES.p2.defaultName,
  CHARACTER_PROFILES.p3.defaultName,
];

export function isCharacterPlayerId(
  value: unknown,
): value is CharacterPlayerId {
  return (
    typeof value === "string" &&
    CHARACTER_PLAYER_IDS.includes(value as CharacterPlayerId)
  );
}

export function characterProfile(
  playerId: CharacterPlayerId,
): CharacterProfile {
  return CHARACTER_PROFILES[playerId];
}
