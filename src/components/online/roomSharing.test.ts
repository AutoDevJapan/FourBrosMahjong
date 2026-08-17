// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { readSharedRoomCode, roomShareUrl } from "./roomSharing";

beforeEach(() => {
  window.history.replaceState({}, "", "/online");
});

describe("online room sharing", () => {
  it("normalizes a valid lowercase shared URL", () => {
    window.history.replaceState({}, "", "/online?room=abc234");

    expect(readSharedRoomCode()).toBe("ABC234");
    expect(roomShareUrl("abc234")).toBe(
      "http://localhost:3000/online?room=ABC234",
    );
  });

  it("rejects characters that are never generated", () => {
    window.history.replaceState({}, "", "/online?room=abci01");

    expect(readSharedRoomCode()).toBeNull();
    expect(roomShareUrl("ABCI01")).toBe("http://localhost:3000/online");
  });
});
