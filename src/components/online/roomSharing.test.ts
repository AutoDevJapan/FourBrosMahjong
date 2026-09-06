// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSharedRoomCode, roomShareUrl } from "./roomSharing";

beforeEach(() => {
  window.history.replaceState({}, "", "/online");
});

afterEach(() => {
  vi.unstubAllGlobals();
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

  it("falls back to a relative URL for an opaque origin", () => {
    vi.stubGlobal("window", { location: { origin: "null" } });

    expect(roomShareUrl("abc234")).toBe("/online?room=ABC234");
  });

  it("falls back when the location origin accessor throws", () => {
    const location = {};
    Object.defineProperty(location, "origin", {
      get: () => {
        throw new Error("origin unavailable");
      },
    });
    vi.stubGlobal("window", { location });

    expect(roomShareUrl("abc234")).toBe("/online?room=ABC234");
  });

  it("ignores a current URL that cannot be read", () => {
    const location = {};
    Object.defineProperty(location, "href", {
      get: () => {
        throw new Error("href unavailable");
      },
    });
    vi.stubGlobal("window", { location });

    expect(readSharedRoomCode()).toBeNull();
  });
});
