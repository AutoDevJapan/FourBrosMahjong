import { describe, expect, it } from "vitest";
import {
  CHARACTER_DEFAULT_NAMES,
  CHARACTER_PLAYER_IDS,
  CHARACTER_PROFILES,
  characterProfile,
  isCharacterPlayerId,
} from "./characters";

describe("四兄弟の固定キャラクター定義(issue #711)", () => {
  it("playerId・既定名・識別色・原本由来portraitの対応を一意に固定する", () => {
    expect(CHARACTER_PROFILES).toEqual({
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
    });
    expect(CHARACTER_DEFAULT_NAMES).toEqual([
      "粗悪品",
      "竜二",
      "マサキ",
      "糸瓜",
    ]);
    expect(JSON.stringify(CHARACTER_PROFILES)).not.toContain("へちま");
  });

  it("未知のIDを受理せず、既知IDのprofileを引ける", () => {
    for (const id of CHARACTER_PLAYER_IDS) {
      expect(isCharacterPlayerId(id)).toBe(true);
      expect(characterProfile(id).playerId).toBe(id);
    }
    expect(isCharacterPlayerId("p4")).toBe(false);
    expect(isCharacterPlayerId(null)).toBe(false);
  });
});
