import type { Page } from "@playwright/test";

export interface ReviewPlaybackState {
  readonly modelId: string;
  readonly clipId: string;
  readonly time: number;
  readonly draws: number;
  readonly playing: boolean;
  readonly pendingState: boolean;
  readonly disposed: boolean;
}

function expected(state: ReviewPlaybackState) {
  if (
    state.modelId !== "p2" ||
    state.clipId !== "declare" ||
    state.pendingState ||
    state.disposed ||
    !Number.isFinite(state.time) ||
    !Number.isSafeInteger(state.draws)
  )
    throw new Error("Review playback source did not settle");
}

/** Actual controls, a zero baseline, moving frames, then two paused frames. */
export async function verifyReviewPlayback(page: Page) {
  await page.locator("#actor").selectOption("p2");
  await page.waitForFunction(() => {
    const state = window.characterReview.telemetry();
    return state.modelId === "p2" && !state.pendingState;
  });
  await page.locator("#clip").selectOption("declare");
  await page.locator("#restart").click();
  const before = await page.evaluate(() => window.characterReview.telemetry());
  expected(before);
  if (before.time !== 0 || before.playing)
    throw new Error("Review playback needs a stopped zero-time baseline");
  await page.locator("#play").click();
  await page.waitForFunction((baseline: ReviewPlaybackState) => {
    const state = window.characterReview.telemetry();
    return (
      state.modelId === "p2" &&
      state.clipId === "declare" &&
      state.playing &&
      !state.pendingState &&
      state.time > baseline.time + 0.15 &&
      state.draws > baseline.draws
    );
  }, before);
  const moving = await page.evaluate(() => window.characterReview.telemetry());
  expected(moving);
  if (
    !moving.playing ||
    moving.time <= before.time + 0.15 ||
    moving.draws <= before.draws
  )
    throw new Error("Review playback did not advance");
  await page.locator("#play").click();
  const paused = await page.evaluate(() => window.characterReview.telemetry());
  expected(paused);
  if (paused.playing || paused.time < moving.time)
    throw new Error("Review playback did not pause");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const after = await page.evaluate(() => window.characterReview.telemetry());
  expected(after);
  if (
    after.playing ||
    after.time !== paused.time ||
    after.draws !== paused.draws
  )
    throw new Error("Review playback changed after pause");
  return { before, moving, paused, after };
}
