import { describe, expect, it } from "vitest";
import {
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_CHARACTER_PATTERN,
  ROOM_CODE_LENGTH,
  ROOM_CODE_PATTERN,
} from "./roomCode";

describe("room code format", () => {
  it("uses one alphabet for generation and validation", () => {
    expect(ROOM_CODE_ALPHABET).toBe("ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
    expect(ROOM_CODE_ALPHABET).not.toMatch(/[IO01]/);
    expect(ROOM_CODE_LENGTH).toBe(6);
    expect(ROOM_CODE_PATTERN.test("ABC234")).toBe(true);
    expect(ROOM_CODE_CHARACTER_PATTERN.test("ABC234")).toBe(true);
  });

  it("normalizes lowercase and whitespace but rejects omitted characters", () => {
    expect(normalizeRoomCode(" abc234 ")).toBe("ABC234");
    for (const character of ["I", "O", "0", "1"]) {
      expect(normalizeRoomCode(`ABC${character}34`)).toBeNull();
    }
  });
});
