/**
 * 半荘終了時に場へ残った供託リーチ棒の帰属(Q15 確定・1位取得 / issue #130)の直接テスト。
 *
 * `settleWin` は和了者が供託を回収して 0 にするため、供託が場に残ったまま半荘が終わるのは
 * 最終局が **流局**(`settleDraw`、トビ流局を含む)で決着したとき。この残存供託(残存本数
 * × 1,000)は **最終持ち点が単独最高**(抜け番含む全員で厳密比較 = Q19 整合)のプレイヤーの
 * 素点へ加算してから順位・精算を確定する。加算により持ち点総和は 140,000 に復し、ソシー精算
 * (素点+ウマ+オカ)は **zero-sum** を保つ。
 *
 * `endGame` は内部関数だが、`finishRound`(公開)がオーラス親流れ流局で `endGame` を呼ぶため、
 * `finishRound` を土台に決定的な局状態を組んで各分岐を 1:1 で検証する
 * (`engine.termination.test.ts` と同じ手法)。
 *
 * 同点最高で単独1位が存在しない場合の帰属は SSOT 未定義(Q20 / issue #131)のため、暫定で
 * 据え置き(消失)= この分岐でのみ zero-sum を満たさないことを固定する。
 */

import { describe, expect, it } from "vitest";
import type { RoundNumber, RoundState, RoundWind } from "../round/round";
import type { PlayerRing } from "../round/seat";
import {
  createGame,
  type EngineState,
  finishRound,
  type PlayerId,
  type RoundConclusion,
} from "./engine";

/** 起家=p0 の固定円環(createGame と同一)。 */
const ORDER: PlayerRing<PlayerId> = ["p0", "p1", "p2", "p3"];

/** 指定の場/局/本場の局状態を組む(席割りは round モジュールが導出)。 */
function roundAt(
  wind: RoundWind,
  roundNumber: RoundNumber,
  honba = 0,
): RoundState<PlayerId> {
  return { order: ORDER, wind, roundNumber, honba };
}

/**
 * オーラス(南4)親流れ流局で `finishRound` → `endGame` を発火させる EngineState を組む。
 * createGame の正当な土台(ledger/players 等)に、終了判定と供託帰属が参照する round /
 * points / riichiSticks だけを差し替える。
 */
function endGameStateWith(
  points: Record<PlayerId, number>,
  riichiSticks: number,
): EngineState {
  const base = createGame({ seed: 130 });
  return { ...base, round: roundAt("south", 4), points, riichiSticks };
}

/** 南4親流れ流局(オーラス完了で半荘終了)の決着結果。 */
const OORASU_DRAW: RoundConclusion = {
  outcome: "dealerPasses",
  isDraw: true,
  summary: {
    kind: "draw",
    label: "流局",
    deltas: { p0: 0, p1: 0, p2: 0, p3: 0 },
  },
};

/** result のソシー合計を集計する。 */
function soshiiSum(state: EngineState): number {
  return (state.result ?? []).reduce((a, r) => a + r.soshiiTotal, 0);
}

/** result から指定プレイヤーの精算行を取り出す。 */
function rowOf(state: EngineState, id: PlayerId) {
  const row = (state.result ?? []).find((r) => r.playerId === id);
  if (row === undefined) throw new Error(`missing settlement row for ${id}`);
  return row;
}

describe("engine 残存供託リーチ棒の帰属(Q15 確定・1位取得 / #130)", () => {
  it("単独1位が残存供託を素点へ取得し、ソシー精算が zero-sum を保つ", () => {
    // sum(points) = 138,000 = 140,000 − 1,000 × 2(供託2本ぶんが場に残っている)。
    const points: Record<PlayerId, number> = {
      p0: 50000, // 単独最高 → 残存供託 2,000 を取得
      p1: 40000,
      p2: 30000,
      p3: 18000,
    };
    const end = finishRound(endGameStateWith(points, 2), OORASU_DRAW);

    expect(end.phase).toBe("gameEnd");
    expect(end.result).toHaveLength(4);
    // 供託は 1位の素点へ移り、場から下りる。
    expect(end.riichiSticks).toBe(0);
    expect(end.points.p0).toBe(52000);
    // 1位の素点 = (持ち点 + 残存供託) − 返し40,000。
    expect(rowOf(end, "p0").rawScore).toBe(52000 - 40000);
    expect(rowOf(end, "p0").rank).toBe(1);
    // 1位取得で持ち点総和は 140,000 に復し、ソシー合計は zero-sum。
    expect(Object.values(end.points).reduce((a, b) => a + b, 0)).toBe(140000);
    expect(soshiiSum(end)).toBe(0);
  });

  it("供託が場に無ければ挙動は不変(素点はそのまま・zero-sum)", () => {
    const points: Record<PlayerId, number> = {
      p0: 50000,
      p1: 40000,
      p2: 30000,
      p3: 20000,
    };
    const end = finishRound(endGameStateWith(points, 0), OORASU_DRAW);

    expect(end.phase).toBe("gameEnd");
    expect(end.riichiSticks).toBe(0);
    expect(end.points.p0).toBe(50000);
    expect(rowOf(end, "p0").rawScore).toBe(50000 - 40000);
    expect(soshiiSum(end)).toBe(0);
  });

  it("抜け番(その局は対局外)が単独最高なら残存供託は抜け番が取得する(Q19 整合)", () => {
    // 南4 の抜け番 = p2(termination テストの席割り前提)。抜け番でも4人全体の単独最高なら取得。
    // sum(points) = 137,000 = 140,000 − 1,000 × 3(供託3本ぶんが場に残っている)。
    const points: Record<PlayerId, number> = {
      p0: 30000,
      p1: 28000,
      p2: 52000, // 抜け番だが単独最高
      p3: 27000,
    };
    const end = finishRound(endGameStateWith(points, 3), OORASU_DRAW);

    expect(end.riichiSticks).toBe(0);
    expect(end.points.p2).toBe(52000 + 3000);
    expect(rowOf(end, "p2").rank).toBe(1);
    expect(soshiiSum(end)).toBe(0);
  });

  it("同点最高で単独1位が無ければ暫定で据え置く(Q20/#131・zero-sum は満たさない)", () => {
    // p0 と p1 が最高点タイ → 単独1位なし。SSOT 未定義のため再配分せず据え置き。
    const points: Record<PlayerId, number> = {
      p0: 50000,
      p1: 50000, // 最高点タイ
      p2: 20000,
      p3: 18000,
    };
    const end = finishRound(endGameStateWith(points, 2), OORASU_DRAW);

    expect(end.phase).toBe("gameEnd");
    // 供託は誰にも渡らず場に残る(従来挙動)。
    expect(end.riichiSticks).toBe(2);
    expect(end.points.p0).toBe(50000);
    expect(end.points.p1).toBe(50000);
    expect(rowOf(end, "p0").rawScore).toBe(50000 - 40000);
    // 据え置き分だけ zero-sum を満たさない(残存供託 × 1,000 の目減り)。
    expect(soshiiSum(end)).toBe(-1000 * 2);
  });
});
