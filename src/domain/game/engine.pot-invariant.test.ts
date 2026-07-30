/**
 * engine レベルの点棒保存則 **`Σ持ち点 + 場に残る供託 = 140,000`** の不変条件テスト(#430)。
 *
 * spec `documents/spec/scoring-and-settlement.md` 3.3「精算入力の前提」の前提を、
 * **精算入口ではなく engine の全過程**で固定する。`src/domain/scoring/settlement.test.ts` は
 * `SoshiiLedger` の入口(= 供託を畳み込んだ後の最終持ち点)しか見ないため、engine 側で
 * 新しい供託種別を足しても入口に届くまで無言で破れる。ここでは供託レジストリの集約
 * {@link potTotal} を使って半荘のあらゆる時点で保存則を確認する。
 *
 * **なぜ `potTotal` を使うか**: 個別種別(`state.riichiSticks`)ではなく集約を参照することで、
 * 供託レジストリ `POT_SOURCES` へ新種別を登録すれば本テストは**自動的に**その種別を含む。
 * 逆に「場へ点棒を移すのにレジストリへ登録しない」実装は本テストで red になる。
 *
 * **両方向の欠陥注入(実測 / #430 の PR で実施)**: 仮の供託種別(満貫罰符 8,000点 =
 * `chomboSticks` 8本)を `EngineState` へ注入して確認した。
 * - `POT_SOURCES` へ登録した場合 … 本テストと `endGame` は緑のまま(畳み込み・精算とも成立)。
 * - 登録しなかった場合 … 保存則テストが red、さらに `endGame` の精算入口
 *   (`SoshiiLedger.applyRawScore`)が `RangeError`(= issue #430 が指摘する対局中クラッシュ)。
 * 注入は検証後に完全に復元済み(本ファイル・engine とも残骸なし)。
 */

import { describe, expect, it } from "vitest";
import type { RoundNumber, RoundState, RoundWind } from "../round/round";
import type { PlayerRing } from "../round/seat";
import { TOTAL_POINTS } from "../scoring/settlement";
import {
  createGame,
  declareAnkan,
  declareKakan,
  declareKan,
  declarePon,
  declareRiichi,
  declareRon,
  declareTsumo,
  discard,
  type EngineState,
  finishRound,
  type PlayerId,
  passRon,
  potTotal,
  proceedToNextRound,
  type RoundConclusion,
  seatOfPlayer,
  tsumogiri,
} from "./engine";

/** 起家=p0 の固定円環(createGame と同一)。 */
const ORDER: PlayerRing<PlayerId> = ["p0", "p1", "p2", "p3"];

/** 4人の持ち点合計。 */
function pointsSum(state: EngineState): number {
  return ORDER.reduce((acc, id) => acc + state.points[id], 0);
}

/**
 * 保存則: `Σ持ち点 + 場の供託 = 140,000`。
 * 供託は**集約**で数えるため、登録済みの種別はすべて自動的に対象になる。
 */
function expectPointsConserved(state: EngineState, label: string): void {
  expect(pointsSum(state) + potTotal(state), label).toBe(TOTAL_POINTS);
}

/** 1半荘の走査結果(空振り防止の実測値つき)。 */
interface SweepResult {
  readonly end: EngineState;
  /** 実行した遷移数。 */
  readonly steps: number;
  /** 途中で場に載った供託の最大額。 */
  readonly potSeen: number;
  /** 供託が増えた遷移の数(リーチ宣言 = 持ち点 → 場)。 */
  readonly potIn: number;
  /** 供託が減った遷移の数(和了時の回収・終局時の畳み込み = 場 → 持ち点)。 */
  readonly potOut: number;
}

/** 1半荘を積極ドライバで完走させ、**各遷移の直後**に保存則を確認する。 */
function playAggressiveChecked(seed: number): SweepResult {
  let s = createGame({ seed });
  let steps = 0;
  let potSeen = 0;
  let potIn = 0;
  let potOut = 0;
  expectPointsConserved(s, `seed=${seed} step=init`);
  for (let guard = 0; guard < 8000 && s.phase !== "gameEnd"; guard++) {
    const beforePot = potTotal(s);
    s = advance(s);
    steps += 1;
    const afterPot = potTotal(s);
    potSeen = Math.max(potSeen, afterPot);
    if (afterPot > beforePot) potIn += 1;
    if (afterPot < beforePot) potOut += 1;
    expectPointsConserved(s, `seed=${seed} step=${steps}`);
  }
  return { end: s, steps, potSeen, potIn, potOut };
}

/** 提示された合法手を積極的に選んで1手進める(`engine.melds-riichi.test.ts` と同方針)。 */
function advance(s: EngineState): EngineState {
  if (s.phase === "roundEnd") return proceedToNextRound(s);
  const pending = s.pending;
  if (pending?.kind === "humanReact") {
    if (pending.canRon) return declareRon(s);
    if (pending.canPon) return declarePon(s);
    if (pending.canKan) return declareKan(s);
    return passRon(s);
  }
  if (pending?.kind === "humanDiscard") {
    if (pending.canTsumo) return declareTsumo(s);
    if (pending.locked) return tsumogiri(s);
    if (pending.kakanTiles.length > 0)
      return declareKakan(s, pending.kakanTiles[0]);
    if (pending.ankanTiles.length > 0)
      return declareAnkan(s, pending.ankanTiles[0]);
    if (pending.canRiichi) return declareRiichi(s, pending.riichiTiles[0]);
    const hand = s.hand;
    const seat = hand ? seatOfPlayer(hand.seating, "p0") : null;
    const forbidden = pending.forbiddenDiscards;
    const isForbidden = (t: { suit: string; rank: number }): boolean =>
      forbidden.some((f) => f.suit === t.suit && f.rank === t.rank);
    let tile = hand?.drawn ?? undefined;
    if ((tile == null || isForbidden(tile)) && hand && seat) {
      tile = hand.hands[seat].find((t) => !isForbidden(t));
    }
    if (tile == null)
      throw new Error("humanDiscard without a discardable tile");
    return discard(s, tile);
  }
  throw new Error(
    `stuck: phase=${s.phase} pending=${s.pending?.kind ?? "none"}`,
  );
}

/** 指定の場/局の局状態(`engine.residual-riichi.test.ts` と同じ組み立て)。 */
function roundAt(
  wind: RoundWind,
  roundNumber: RoundNumber,
): RoundState<PlayerId> {
  return { order: ORDER, wind, roundNumber, honba: 0 };
}

/** オーラス(南4)親流れ流局で `finishRound` → `endGame` を発火させる状態。 */
function endGameStateWith(
  points: Record<PlayerId, number>,
  riichiSticks: number,
): EngineState {
  const base = createGame({ seed: 430 });
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

describe("engine 不変条件: Σ持ち点 + 場の供託 = 140,000(#430)", () => {
  it("半荘のあらゆる時点で保存則が成立し、終局時には供託が場に残らない", () => {
    let totalSteps = 0;
    let maxPotSeen = 0;
    let potIn = 0;
    let potOut = 0;
    for (const seed of [1, 3, 8, 42, 99, 2024]) {
      const sweep = playAggressiveChecked(seed);
      const { end, steps, potSeen } = sweep;
      potIn += sweep.potIn;
      potOut += sweep.potOut;
      expect(end.phase, `seed=${seed}`).toBe("gameEnd");
      // 終局時は全種別の供託が畳み込まれ、場には何も残らない。
      expect(potTotal(end), `seed=${seed} pot at gameEnd`).toBe(0);
      expect(pointsSum(end), `seed=${seed} points at gameEnd`).toBe(
        TOTAL_POINTS,
      );
      // 精算はゼロサム(供託の畳み込み漏れがあると成立しない)。
      const soshii = (end.result ?? []).reduce((a, r) => a + r.soshiiTotal, 0);
      expect(soshii, `seed=${seed} soshii`).toBe(0);
      totalSteps += steps;
      maxPotSeen = Math.max(maxPotSeen, potSeen);
    }
    // 空振り防止: 多数の遷移を走査し、**持ち点 → 場**(リーチ宣言)と
    // **場 → 持ち点**(和了時の回収・終局時の畳み込み)の双方向の点棒移動を
    // 実際に跨いで保存則を検査している。
    expect(totalSteps).toBeGreaterThan(100);
    expect(maxPotSeen).toBeGreaterThan(0);
    expect(potIn).toBeGreaterThan(0);
    expect(potOut).toBeGreaterThan(0);
  });

  it("終局時の畳み込みは供託の集約に対して行われる(残存あり → 場は 0・合計は 140,000)", () => {
    // sum(points) = 138,000 = 140,000 − 供託2本。畳み込み前は保存則が「供託込み」で成立し、
    // 畳み込み後は持ち点だけで 140,000 に復する。
    const points: Record<PlayerId, number> = {
      p0: 50000,
      p1: 40000,
      p2: 30000,
      p3: 18000,
    };
    const before = endGameStateWith(points, 2);
    expect(pointsSum(before)).toBe(TOTAL_POINTS - 2000);
    expect(potTotal(before)).toBe(2000);
    expectPointsConserved(before, "before endGame");

    const end = finishRound(before, OORASU_DRAW);
    expect(end.phase).toBe("gameEnd");
    expect(potTotal(end)).toBe(0);
    expect(pointsSum(end)).toBe(TOTAL_POINTS);
    expectPointsConserved(end, "after endGame");
  });

  it("供託が場に無ければ終局処理は持ち点を動かさない", () => {
    const points: Record<PlayerId, number> = {
      p0: 50000,
      p1: 40000,
      p2: 30000,
      p3: 20000,
    };
    const end = finishRound(endGameStateWith(points, 0), OORASU_DRAW);
    expect(end.points).toEqual(points);
    expect(potTotal(end)).toBe(0);
    expectPointsConserved(end, "no pot");
  });
});
