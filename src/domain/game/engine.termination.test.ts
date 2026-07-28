/**
 * 半荘終了条件(spec 2.8 / issue #114)の直接テスト。
 *
 * `finishRound`(engine.ts)の終了3経路を、決定的に構成した局状態(round)+持ち点で
 * 1:1 に検証する。既存の `engine.test.ts` / `engine.melds-riichi.test.ts` は seed 固定で
 * 半荘を完走させ「最終的に gameEnd になる/ゼロサム」だけを見るため、**どの終了条件で
 * 終わったか**は未カバーだった(本ファイルがその穴を埋める)。
 *
 * spec 2.8(`documents/spec/game-flow.md`)の3経路:
 *   1. 南4(オーラス)親3万超トップ → 親トップやめ(和了やめ/テンパイやめ相当)。南4以外では不発火。
 *   2. トビ(いずれかの持ち点<0)→ 任意の局で即終了。
 *   3. 上記以外で南4が親流れ/非親和了で終わる → 南4完了で終了。
 *
 * `finishRound` は本来 `settleWin`/`settleDraw` からのみ呼ばれる内部遷移だが、各分岐を
 * 直接構成できるよう engine.ts で `export` 済み(テスト容易性のための最小公開)。
 *
 * 親トップやめの「トップ」= **抜け番を含む4兄弟全員に対する単独最高**(かつ >30,000)で判定する
 * (Q19 確定・ユーザー承認 2026-07-17 / issue #122)。SSOT(`docs/四兄弟麻雀ルール.md` §5
 * 「オーラスで親が3万点を超えてトップ」)の「トップ」を、抜け番の持ち点も含めた4人全体での
 * **単独最高**と確定した(同点最高は「単独トップ」でないため終了せず継続)。
 */

import { describe, expect, it } from "vitest";
import {
  benchWarmerOf,
  dealerOf,
  type RoundNumber,
  type RoundState,
  type RoundWind,
} from "../round/round";
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
 * 決定的な終了判定入力を組む。createGame で得た正当な EngineState(ledger/players 等)を土台に、
 * 終了判定が参照する round / points / roundsPlayed だけを差し替える。`finishRound` は hand を
 * 参照しないため、East1 の配牌のまま任意局の終了判定を評価できる。
 */
function stateFor(
  round: RoundState<PlayerId>,
  points: Record<PlayerId, number>,
  roundsPlayed = 0,
): EngineState {
  const base = createGame({ seed: 114 });
  return { ...base, round, points, roundsPlayed };
}

/** 和了/流局の決着結果(サマリ本文は終了判定に影響しないためダミー)。 */
function conclusion(
  outcome: RoundConclusion["outcome"],
  isDraw: boolean,
): RoundConclusion {
  return {
    outcome,
    isDraw,
    summary: {
      kind: isDraw ? "draw" : "win",
      label: "test",
      deltas: { p0: 0, p1: 0, p2: 0, p3: 0 },
    },
  };
}

/** 全員均等持ち点。 */
function even(points: number): Record<PlayerId, number> {
  return { p0: points, p1: points, p2: points, p3: points };
}

describe("engine 終了条件(spec 2.8 / #114)", () => {
  // 席割りの前提を固定(deriveSeating: south4 の親=p3・抜け番=p2、East1 の親=p0)。
  it("[前提] round モジュールの席割りが想定どおり(親/抜け番)", () => {
    expect(dealerOf(roundAt("east", 1))).toBe("p0");
    const s4 = roundAt("south", 4);
    expect(dealerOf(s4)).toBe("p3");
    expect(benchWarmerOf(s4)).toBe("p2");
  });

  describe("経路2: トビ(持ち点<0 → 任意の局で即終了)", () => {
    it("東1で非親がマイナス → 即 gameEnd(親流れでも)", () => {
      const s = finishRound(
        stateFor(roundAt("east", 1), {
          p0: 35000,
          p1: -100,
          p2: 80000,
          p3: 25100,
        }),
        conclusion("dealerPasses", false),
      );
      expect(s.phase).toBe("gameEnd");
      expect(s.result).not.toBeNull();
      expect(s.nextRoundState).toBeNull();
    });

    it("親連荘(dealerContinues)でもトビが優先して即 gameEnd", () => {
      // 東1・親 p0 が大量リードでも、別家がマイナスなら継続せず終了(トビ優先)。
      const s = finishRound(
        stateFor(roundAt("east", 1), {
          p0: 90000,
          p1: -500,
          p2: 45000,
          p3: 5500,
        }),
        conclusion("dealerContinues", false),
      );
      expect(s.phase).toBe("gameEnd");
      expect(s.nextRoundState).toBeNull();
    });

    it("流局(isDraw)でトビ → gameEnd", () => {
      const s = finishRound(
        stateFor(roundAt("east", 2), {
          p0: -1,
          p1: 70000,
          p2: 35001,
          p3: 35000,
        }),
        conclusion("dealerPasses", true),
      );
      expect(s.phase).toBe("gameEnd");
    });

    it("境界: 持ち点=0 はトビでない(<0 厳密)→ 半荘継続", () => {
      // 東1・親流れ・親トップでない → 終了条件どれにも該当せず継続。
      const s = finishRound(
        stateFor(roundAt("east", 1), {
          p0: 35000,
          p1: 0,
          p2: 40000,
          p3: 30000,
        }),
        conclusion("dealerPasses", false),
      );
      expect(s.phase).toBe("roundEnd");
      expect(s.nextRoundState).not.toBeNull();
      expect(s.result).toBeNull();
    });
  });

  describe("経路3: 南4完了(親流れ/非親和了で終了)", () => {
    it("南4・親流れ(dealerPasses・親ノーテン流局)→ gameEnd", () => {
      const s = finishRound(
        stateFor(roundAt("south", 4), {
          p0: 40000,
          p1: 20000,
          p2: 65000,
          p3: 15000,
        }),
        conclusion("dealerPasses", true),
      );
      expect(s.phase).toBe("gameEnd");
      expect(s.nextRoundState).toBeNull();
    });

    it("南4・非親和了(dealerPasses・非トビ)→ gameEnd(親3万超トップでなくても)", () => {
      // 親 p3=15000(トップでない)。子の和了で親流れ → 南4完了で終了。
      const s = finishRound(
        stateFor(roundAt("south", 4), {
          p0: 70000,
          p1: 30000,
          p2: 25000,
          p3: 15000,
        }),
        conclusion("dealerPasses", false),
      );
      expect(s.phase).toBe("gameEnd");
    });
  });

  describe("経路1: 南4 親3万超トップやめ(dealerContinues)", () => {
    it("南4・親和了・親>30,000かつトップ → gameEnd(親トップやめ)", () => {
      // 親 p3=40000 が単独トップ。
      const s = finishRound(
        stateFor(roundAt("south", 4), {
          p0: 30000,
          p1: 30000,
          p2: 30000,
          p3: 50000,
        }),
        conclusion("dealerContinues", false),
      );
      expect(s.phase).toBe("gameEnd");
      expect(s.nextRoundState).toBeNull();
    });

    it("南4・親テンパイ(流局連荘)・親>30,000トップ → gameEnd", () => {
      const s = finishRound(
        stateFor(roundAt("south", 4), {
          p0: 20000,
          p1: 45000,
          p2: 20000,
          p3: 55000,
        }),
        conclusion("dealerContinues", true),
      );
      expect(s.phase).toBe("gameEnd");
    });

    it("南4・親連荘だが親がトップでない(子が上) → 半荘継続(連荘)", () => {
      // 親 p3=31000(>30000)でも p0=50000 が上 → トップやめ不成立 → 連荘。
      const s = finishRound(
        stateFor(roundAt("south", 4, 2), {
          p0: 50000,
          p1: 10000,
          p2: 9000,
          p3: 31000,
        }),
        conclusion("dealerContinues", false),
      );
      expect(s.phase).toBe("roundEnd");
      expect(s.nextRoundState).not.toBeNull();
      // 連荘 = 同場同局・本場+1。
      expect(s.nextRoundState?.wind).toBe("south");
      expect(s.nextRoundState?.roundNumber).toBe(4);
      expect(s.nextRoundState?.honba).toBe(3);
    });

    it("境界: 南4・親トップだが持ち点=30,000ちょうど(>30000 でない) → 継続", () => {
      // 親 p3=30000 が単独最高でも「3万点を超えて」いない → やめ不成立。
      const s = finishRound(
        stateFor(roundAt("south", 4), {
          p0: 20000,
          p1: 25000,
          p2: 15000,
          p3: 30000,
        }),
        conclusion("dealerContinues", false),
      );
      expect(s.phase).toBe("roundEnd");
      expect(s.nextRoundState).not.toBeNull();
    });

    it("南4・親トップだが3万以下(28,000) → 継続", () => {
      const s = finishRound(
        stateFor(roundAt("south", 4), {
          p0: 27000,
          p1: 25000,
          p2: 20000,
          p3: 28000,
        }),
        conclusion("dealerContinues", false),
      );
      expect(s.phase).toBe("roundEnd");
    });
  });

  describe("南4以外では親3万超トップでも継続する(spec 2.8 受け入れ基準)", () => {
    const nonOorasu: ReadonlyArray<[RoundWind, RoundNumber]> = [
      ["east", 1],
      ["east", 4],
      ["south", 1],
      ["south", 3],
    ];
    for (const [wind, num] of nonOorasu) {
      it(`${wind}${num}: 親>30,000トップ・親連荘でも継続(オーラス限定の発火)`, () => {
        const round = roundAt(wind, num);
        const dealer = dealerOf(round);
        // 親を単独トップ(90000)、他は均等に低く。
        const points = even(5000);
        points[dealer] = 90000;
        const s = finishRound(
          stateFor(round, points),
          conclusion("dealerContinues", false),
        );
        expect(s.phase).toBe("roundEnd");
        expect(s.nextRoundState).not.toBeNull();
      });
    }

    it("南3・親流れ(親3万超トップ)でも継続 → 次局へ進む", () => {
      const round = roundAt("south", 3);
      const dealer = dealerOf(round);
      const points = even(5000);
      points[dealer] = 90000;
      const s = finishRound(
        stateFor(round, points),
        conclusion("dealerPasses", false),
      );
      expect(s.phase).toBe("roundEnd");
      // 親流れ = 次場/次局へ(南3→南4)。
      expect(s.nextRoundState?.wind).toBe("south");
      expect(s.nextRoundState?.roundNumber).toBe(4);
    });
  });

  describe("dealerIsTop の同点/抜け番裁定(Q19 確定・抜け番含む全員で厳密比較)", () => {
    // Q19 確定(ユーザー承認 2026-07-17 / #122): 「トップ」= 抜け番を含む4兄弟全員に対する
    // **単独最高**(かつ >30,000)。同点最高は「単独トップ」でないため終了せず継続する。
    // 抜け番(対局外の第4者)の持ち点も比較対象に含める。

    it("南4・親が抜け番含む全員に対し単独最高(親>30000) → 親トップやめで gameEnd", () => {
      const round = roundAt("south", 4);
      const dealer = dealerOf(round); // p3
      const bench = benchWarmerOf(round); // p2(この局は対局外)
      const points = even(30500);
      points[dealer] = 40000; // 親が単独最高(抜け番含む全員より真に高い)
      points[bench] = 39000; // 抜け番は親より低い
      const s = finishRound(
        stateFor(round, points),
        conclusion("dealerContinues", false),
      );
      expect(s.phase).toBe("gameEnd");
      expect(s.nextRoundState).toBeNull();
    });

    it("南4・親と抜け番が同点最高(親>30000・単独トップでない) → 継続", () => {
      const round = roundAt("south", 4);
      const dealer = dealerOf(round); // p3
      const bench = benchWarmerOf(round); // p2(この局は対局外)
      const points = even(10000);
      points[dealer] = 40000;
      points[bench] = 40000; // 抜け番が親と同点最高 → 単独トップでない → 継続
      const s = finishRound(
        stateFor(round, points),
        conclusion("dealerContinues", false),
      );
      expect(s.phase).toBe("roundEnd");
      expect(s.nextRoundState).not.toBeNull();
    });

    it("南4・親と着席他家が同点最高(親>30000・単独トップでない) → 継続", () => {
      const round = roundAt("south", 4);
      const dealer = dealerOf(round); // p3
      const points = even(10000);
      points[dealer] = 40000;
      points.p0 = 40000; // 着席他家(south)が親と同点最高 → 単独トップでない → 継続
      const s = finishRound(
        stateFor(round, points),
        conclusion("dealerContinues", false),
      );
      expect(s.phase).toBe("roundEnd");
      expect(s.nextRoundState).not.toBeNull();
    });

    it("南4・抜け番が親より真に高い(親はトップでない) → 継続", () => {
      const round = roundAt("south", 4);
      const dealer = dealerOf(round);
      const bench = benchWarmerOf(round);
      const points = even(10000);
      points[dealer] = 40000;
      points[bench] = 41000; // 抜け番が親を上回る → dealerIsTop=false
      const s = finishRound(
        stateFor(round, points),
        conclusion("dealerContinues", false),
      );
      expect(s.phase).toBe("roundEnd");
    });
  });

  describe("gameEnd でも最終局の決着サマリ(lastRound)を保持する(#277 回帰)", () => {
    // 半荘を終える局は roundEnd を経由せず gameEnd へ直行するが、UI(GameBoard / gameView)は
    // gameEnd でも `lastRound`(和了内訳スナップショット・点数デルタ)を読んで最終局の決着を
    // 表示する(#277)。endGame がサマリを落とすと最終局の内訳が二度と確認できなくなる。

    it("トビ終了(gameEnd)でも lastRound に決着サマリを保持する", () => {
      const c = conclusion("dealerPasses", false);
      const s = finishRound(
        stateFor(roundAt("east", 3), {
          p0: -25000,
          p1: 59000,
          p2: 79000,
          p3: 27000,
        }),
        c,
      );
      expect(s.phase).toBe("gameEnd");
      expect(s.lastRound).toBe(c.summary);
      expect(s.result).not.toBeNull();
    });

    it("南4完了(gameEnd)でも lastRound を保持する", () => {
      const c = conclusion("dealerPasses", true);
      const s = finishRound(
        stateFor(roundAt("south", 4), {
          p0: 40000,
          p1: 20000,
          p2: 65000,
          p3: 15000,
        }),
        c,
      );
      expect(s.phase).toBe("gameEnd");
      expect(s.lastRound).toBe(c.summary);
    });

    it("親トップやめ(gameEnd)でも lastRound を保持する", () => {
      const c = conclusion("dealerContinues", false);
      const s = finishRound(
        stateFor(roundAt("south", 4), {
          p0: 30000,
          p1: 30000,
          p2: 30000,
          p3: 50000,
        }),
        c,
      );
      expect(s.phase).toBe("gameEnd");
      expect(s.lastRound).toBe(c.summary);
    });

    it("半荘継続(roundEnd)の遷移は従来どおり(lastRound 保持・次局遷移あり・結果未確定)", () => {
      const c = conclusion("dealerPasses", false);
      const s = finishRound(stateFor(roundAt("east", 1), even(35000)), c);
      expect(s.phase).toBe("roundEnd");
      expect(s.lastRound).toBe(c.summary);
      expect(s.nextRoundState).not.toBeNull();
      expect(s.result).toBeNull();
    });
  });

  describe("安全上限(SAFETY_ROUND_CAP)による強制終了(characterization)", () => {
    // 南4連荘の理論的無限ループ防止。spec 2.8 の3経路とは別枠の安全弁(通常は不発火)。
    it("roundsPlayed が上限直前なら、終了条件非該当でも gameEnd に落ちる", () => {
      // 東1・親トップでない・トビなし = 通常なら継続。roundsPlayed=31(+1=32=上限)で強制終了。
      const s = finishRound(
        stateFor(roundAt("east", 1), even(35000), 31),
        conclusion("dealerContinues", false),
      );
      expect(s.phase).toBe("gameEnd");
    });

    it("上限に十分な余裕があれば通常どおり継続する", () => {
      const s = finishRound(
        stateFor(roundAt("east", 1), even(35000), 5),
        conclusion("dealerContinues", false),
      );
      expect(s.phase).toBe("roundEnd");
    });
  });
});
