import type { Page } from "@playwright/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ReviewPlaybackState,
  verifyReviewPlayback,
} from "./review-playback";

afterEach(() => vi.unstubAllGlobals());

/** A deterministic page/clock boundary, not a browser/renderer substitute. */
function pageFixture({
  noPlay = false,
  noPause = false,
  hiddenRunning = false,
  actorPending = false,
} = {}) {
  let running = false;
  const state = {
    modelId: "p3",
    clipId: "win-ron",
    time: 1.8,
    draws: 20,
    playing: false,
    pendingState: false,
    disposed: false,
  };
  let actor: string | undefined;
  const tick = () => {
    if (actor) {
      state.modelId = actor;
      state.pendingState = false;
      actor = undefined;
    }
    if (running) {
      state.time += 0.1;
      state.draws++;
    }
  };
  vi.stubGlobal("window", {
    characterReview: { telemetry: () => ({ ...state }) },
  });
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
    queueMicrotask(() => {
      tick();
      callback();
    });
    return 1;
  });
  const page = {
    locator: (selector: string) => ({
      selectOption: async (value: string) => {
        if (selector === "#actor") {
          if (actorPending) {
            actor = value;
            state.pendingState = true;
          } else state.modelId = value;
        } else if (selector === "#clip") {
          if (state.pendingState)
            throw new Error("clip changed before actor settled");
          state.clipId = value;
          state.time = 0;
        }
      },
      click: async () => {
        if (selector === "#restart") state.time = 0;
        if (selector === "#play") {
          if (running) {
            running = noPause || hiddenRunning;
            state.playing = noPause;
          } else {
            running = !noPlay;
            state.playing = !noPlay;
          }
        }
      },
    }),
    evaluate: async (callback: () => unknown) => callback(),
    waitForFunction: async (
      callback: (value?: ReviewPlaybackState) => unknown,
      value?: ReviewPlaybackState,
    ) => {
      for (let attempts = 0; attempts < 6; attempts++) {
        if (callback(value)) return;
        tick();
      }
      throw new Error("fixture predicate timeout");
    },
  } as unknown as Page;
  return page;
}

describe("review playback proof", () => {
  it("waits for the actor, resets a stale finished time, observes movement and two paused frames", async () => {
    const result = await verifyReviewPlayback(
      pageFixture({ actorPending: true }),
    );
    expect(result.before).toMatchObject({
      modelId: "p2",
      clipId: "declare",
      time: 0,
      playing: false,
      pendingState: false,
    });
    expect(result.moving.time).toBeGreaterThan(0.15);
    expect(result.moving.draws).toBeGreaterThan(result.before.draws);
    expect(result.after).toEqual(result.paused);
  });

  it("rejects a play control that never starts", async () => {
    await expect(
      verifyReviewPlayback(pageFixture({ noPlay: true })),
    ).rejects.toThrow("fixture predicate timeout");
  });

  it("rejects a pause control that leaves playback active", async () => {
    await expect(
      verifyReviewPlayback(pageFixture({ noPause: true })),
    ).rejects.toThrow("Review playback did not pause");
  });

  it("rejects a stopped label when time still advances in later frames", async () => {
    await expect(
      verifyReviewPlayback(pageFixture({ hiddenRunning: true })),
    ).rejects.toThrow("Review playback changed after pause");
  });
});
