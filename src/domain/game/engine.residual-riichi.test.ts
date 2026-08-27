/**
 * 半荘終了時に場へ残った供託リーチ棒の帰属(Q15 確定・1位取得 / #130、Q20 確定・同点最高の
 * うち席順上位が総取り / issue #131)の直接テスト。
 *
 * `settleWin` は和了者が供託を回収して 0 にするため、供託が場に残ったまま半荘が終わるのは
 * 最終局が **流局**(`settleDraw`、トビ流局を含む)で決着したとき。この残存供託(残存本数
 * × 1,000)は **最終持ち点が最高**(抜け番含む全員で厳密比較 = Q19 整合)のプレイヤーの
 * 素点へ加算してから順位・精算を確定する。**同点最高で単独1位が存在しない場合は席順
 * (固定円環 `order` の先頭 = 起家に近い順)で最上位の1人が総取り**する(Q20)。いずれの場合も
 * 帰属先が一意に定まり、加算により持ち点総和は 140,000 に復してソシー精算(素点+ウマ+オカ)は
 * **zero-sum** を保つ。
 *
 * `endGame` は内部関数だが、`finishRound`(公開)がオーラス親流れ流局で `endGame` を呼ぶため、
 * `finishRound` を土台に決定的な局状態を組んで各分岐を 1:1 で検証する
 * (`engine.termination.test.ts` と同じ手法)。
 */

import { describe, expect, it } from "vitest";
import {
  endGameStateWith as buildEndGameState,
  OORASU_DRAW,
  TEST_PLAYER_ORDER as ORDER,
} from "./__testing__/engine-fixtures";
import {
  type EngineState,
  finishRound,
  type PlayerId,
  type RoundConclusion,
} from "./engine";

/**
 * オーラス(南4)親流れ流局で `finishRound` → `endGame` を発火させる EngineState を組む。
 * createGame の正当な土台(ledger/players 等)に、終了判定と供託帰属が参照する round /
 * points / riichiSticks だけを差し替える。
 */
function endGameStateWith(
  points: Record<PlayerId, number>,
  riichiSticks: number,
): EngineState {
  return buildEndGameState(points, {
    seed: 130,
    overrides: { riichiSticks },
  });
}

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

describe("engine 残存供託リーチ棒の帰属(Q15 = 1位取得 / #130・Q20 = 同点最高のうち席順上位が総取り / #131)", () => {
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

  it("同点最高2人(p0/p1)なら席順上位=起家 p0 が総取りし zero-sum を保つ(Q20/#131)", () => {
    // p0 と p1 が最高点タイ → 単独1位なし。席順(order 先頭 = 起家 p0)で最上位の p0 が総取り。
    // sum(points) = 138,000 = 140,000 − 1,000 × 2。
    const points: Record<PlayerId, number> = {
      p0: 50000, // 最高点タイ・席順上位(起家)→ 残存供託 2,000 を総取り
      p1: 50000, // 最高点タイだが席順下位
      p2: 20000,
      p3: 18000,
    };
    const end = finishRound(endGameStateWith(points, 2), OORASU_DRAW);

    expect(end.phase).toBe("gameEnd");
    // 供託は席順上位の p0 の素点へ移り、場から下りる。
    expect(end.riichiSticks).toBe(0);
    expect(end.points.p0).toBe(52000);
    expect(end.points.p1).toBe(50000); // 席順下位は据え置き。
    expect(rowOf(end, "p0").rawScore).toBe(52000 - 40000);
    // 帰属先が一意に定まるため持ち点総和は 140,000 に復し zero-sum。
    expect(Object.values(end.points).reduce((a, b) => a + b, 0)).toBe(140000);
    expect(soshiiSum(end)).toBe(0);
  });

  it("同点最高2人が起家以外(p1/p2)でも席順上位 p1 が総取りする(Q20/#131)", () => {
    // 起家 p0 は最高点でない。最高点タイの p1・p2 のうち席順(order 上)で上位の p1 が総取り。
    const points: Record<PlayerId, number> = {
      p0: 40000,
      p1: 45000, // 最高点タイ・p2 より席順上位 → 総取り
      p2: 45000, // 最高点タイだが席順下位
      p3: 8000,
    };
    const end = finishRound(endGameStateWith(points, 2), OORASU_DRAW);

    expect(end.riichiSticks).toBe(0);
    expect(end.points.p1).toBe(47000);
    expect(end.points.p2).toBe(45000);
    expect(rowOf(end, "p1").rank).toBe(1);
    expect(soshiiSum(end)).toBe(0);
  });

  it("同点最高3人(p1/p2/p3)なら席順最上位 p1 が総取りする(Q20/#131)", () => {
    // 3人が最高点タイ。席順(order = [p0,p1,p2,p3])で最上位の p1 が総取り。
    // sum(points) = 137,000 = 140,000 − 1,000 × 3。
    const points: Record<PlayerId, number> = {
      p0: 14000,
      p1: 41000, // 最高点タイ・3人中で席順最上位 → 総取り
      p2: 41000,
      p3: 41000,
    };
    const end = finishRound(endGameStateWith(points, 3), OORASU_DRAW);

    expect(end.riichiSticks).toBe(0);
    expect(end.points.p1).toBe(44000);
    expect(end.points.p2).toBe(41000);
    expect(end.points.p3).toBe(41000);
    expect(rowOf(end, "p1").rank).toBe(1);
    expect(soshiiSum(end)).toBe(0);
  });

  it("残存供託は最終局デルタへ畳み込まれ、帰属記録つきで三者一貫の検算が成立する(#282)", () => {
    // 実際の流局決着に近い形: ノーテン罰符(テンパイ1人 = p3 が +3,000、ノーテン2人が
    // −1,500ずつ)を deltas に持つサマリで南4流局終了。供託2本が場に残存し、
    // 単独最高の p0 が取得する。
    const roundDeltas: Record<PlayerId, number> = {
      p0: -1500,
      p1: -1500,
      p2: 0, // 抜け番
      p3: 3000,
    };
    // 局開始時点の持ち点(sum = 138,000 = 140,000 − 供託2本)。
    const startPoints: Record<PlayerId, number> = {
      p0: 51500,
      p1: 41500,
      p2: 25000,
      p3: 20000,
    };
    // finishRound へ渡すのは局精算後の持ち点。
    const points = Object.fromEntries(
      ORDER.map((id) => [id, startPoints[id] + roundDeltas[id]]),
    ) as Record<PlayerId, number>;
    const conclusion: RoundConclusion = {
      outcome: "dealerPasses",
      isDraw: true,
      summary: {
        kind: "draw",
        label: "流局(テンパイ1人)",
        deltas: roundDeltas,
      },
    };
    const end = finishRound(endGameStateWith(points, 2), conclusion);

    expect(end.phase).toBe("gameEnd");
    // (a) 供託カウントは 0(場から下りた)。
    expect(end.riichiSticks).toBe(0);
    // (b) 受取者のデルタに残存供託が畳み込まれる(−1,500 + 2,000 = +500)。
    expect(end.lastRound?.deltas.p0).toBe(-1500 + 2000);
    // 受取者以外のデルタは局の移動のまま。
    expect(end.lastRound?.deltas.p1).toBe(-1500);
    expect(end.lastRound?.deltas.p2).toBe(0);
    expect(end.lastRound?.deltas.p3).toBe(3000);
    // (c) 三者一貫: 局開始持ち点 + 表示デルタ = 表示持ち点 が全員で成立する。
    for (const id of ORDER) {
      expect(startPoints[id] + (end.lastRound?.deltas[id] ?? 0)).toBe(
        end.points[id],
      );
    }
    // 帰属記録(表示・検算用スナップショット)。
    expect(end.lastRound?.residualSticks).toEqual({
      recipientId: "p0",
      recipientName: "粗悪品",
      sticks: 2,
      points: 2000,
    });
    // デルタ総和 = 残存供託ぶんだけ正(場の供託 2本 → 0本 と相殺し卓全体では不変)。
    const deltaSum = ORDER.reduce(
      (a, id) => a + (end.lastRound?.deltas[id] ?? 0),
      0,
    );
    expect(deltaSum).toBe(2000);
    expect(soshiiSum(end)).toBe(0);
  });

  it("供託が残存しなければ最終局デルタは不変で帰属記録も付かない(#282)", () => {
    const points: Record<PlayerId, number> = {
      p0: 50000,
      p1: 40000,
      p2: 30000,
      p3: 20000,
    };
    const end = finishRound(endGameStateWith(points, 0), OORASU_DRAW);

    expect(end.phase).toBe("gameEnd");
    expect(end.lastRound?.deltas).toEqual({ p0: 0, p1: 0, p2: 0, p3: 0 });
    expect(end.lastRound?.residualSticks).toBeUndefined();
  });

  it("残存供託が抜け番へ帰属した場合もデルタへ畳み込まれる(#282 × Q19)", () => {
    // 南4 の抜け番 = p2 が単独最高 → 残存供託3本(3,000点)を取得。
    const points: Record<PlayerId, number> = {
      p0: 30000,
      p1: 28000,
      p2: 52000,
      p3: 27000,
    };
    const end = finishRound(endGameStateWith(points, 3), OORASU_DRAW);

    expect(end.lastRound?.deltas.p2).toBe(3000);
    expect(end.lastRound?.residualSticks?.recipientId).toBe("p2");
    expect(end.lastRound?.residualSticks?.sticks).toBe(3);
    expect(end.points.p2).toBe(52000 + 3000);
  });

  it("抜け番(南4=p2)を含む同点最高でも席順で裁定する(Q19 比較 × Q20 帰属)", () => {
    // 南4 の抜け番 = p2。着席 p1 と抜け番 p2 が最高点タイ → 抜け番も比較対象(Q19)だが、
    // 席順(order 上で p1 が p2 より上位)で最上位の p1 が総取りする。
    const points: Record<PlayerId, number> = {
      p0: 20000,
      p1: 49000, // 最高点タイ(着席)・席順上位 → 総取り
      p2: 49000, // 最高点タイ(抜け番)だが席順下位
      p3: 20000,
    };
    const end = finishRound(endGameStateWith(points, 2), OORASU_DRAW);

    expect(end.riichiSticks).toBe(0);
    expect(end.points.p1).toBe(51000);
    expect(end.points.p2).toBe(49000);
    expect(rowOf(end, "p1").rank).toBe(1);
    expect(soshiiSum(end)).toBe(0);
  });
});
