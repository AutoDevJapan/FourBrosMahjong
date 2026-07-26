import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { walkToGameEnd } from "@/components/game/finishedGameFixture";
import {
  aiMemoDiagnosticsForTests,
  SHANTEN_MEMO_CAP,
  SUIT_MEMO_CAP,
} from "./ai";

describe("AI memoの長時間安定性(#362)", () => {
  beforeEach(() => aiMemoDiagnosticsForTests.clear());
  afterEach(() => aiMemoDiagnosticsForTests.clear());

  it("60半荘を連続完走しても両memoが固定容量を超えず、結果はcache状態に依存しない", () => {
    const coldExpected = walkToGameEnd(1).state.result;

    for (let seed = 2; seed <= 61; seed++) walkToGameEnd(seed);

    expect(aiMemoDiagnosticsForTests.sizes()).toEqual({
      shanten: SHANTEN_MEMO_CAP,
      suit: SUIT_MEMO_CAP,
    });
    expect(walkToGameEnd(1).state.result).toEqual(coldExpected);
    expect(aiMemoDiagnosticsForTests.sizes().shanten).toBeLessThanOrEqual(
      SHANTEN_MEMO_CAP,
    );
    expect(aiMemoDiagnosticsForTests.sizes().suit).toBeLessThanOrEqual(
      SUIT_MEMO_CAP,
    );
  }, 30_000);
});
