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

  it("両memoを上限まで使っても固定容量を超えず、結果はcache状態に依存しない", () => {
    const coldExpected = walkToGameEnd(1).state.result;

    // #452 の実測では shanten memo は seed=7、suit memo は seed=12 で上限に達する。
    // 旧テストの seed=13..61 は既に上限へ達した後の反復で、assert の検証内容を増やさず
    // CPU 負荷時の timeout だけを招いていた。seed=12 までで両memoの満杯状態を作り、
    // 下の再実行で満杯状態からの退避と cache 状態に依存しない結果を同時に固定する。
    for (let seed = 2; seed <= 12; seed++) walkToGameEnd(seed);

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
