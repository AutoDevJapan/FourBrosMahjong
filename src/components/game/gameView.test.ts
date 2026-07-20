import { describe, expect, it } from "vitest";
import {
  createGame,
  type EngineState,
  finishRound,
  type PlayerId,
  type RoundConclusion,
  seatOfPlayer,
} from "@/domain/game/engine";
import { walkToGameEnd } from "./finishedGameFixture";
import { selectView } from "./gameView";

describe("selectView pointsDelta projection(#277)", () => {
  it("半荘を終える局(gameEnd 直行)でも最終局の点数増減を写像する", () => {
    // seed=2024 の最終局は 東4・一郎(p1)のロン 7,700点(自家 p0 が放銃 / #294 の AI 変更後に再確認)。
    const { state } = walkToGameEnd(2024);
    expect(state.phase).toBe("gameEnd");
    expect(state.lastRound).not.toBeNull();

    const view = selectView(state);
    const self = view.slots.self;
    expect(self.kind).toBe("seated");
    if (self.kind === "seated") {
      expect(self.player.pointsDelta).toBe(state.lastRound?.deltas.p0);
      expect(self.player.pointsDelta).toBeLessThan(0);
    }
  });

  it("gameEnd の残存供託が抜け番へ帰属したら抜け番スロットにも点差を写像する(#282)", () => {
    // 流局で半荘が終わり供託が残存 → 単独最高の抜け番が取得(Q15 × Q19)。
    // 抜け番の持ち点は局中不変だが、gameEnd の残存供託畳み込みで点差が生じ得る。
    const base = createGame({ seed: 130 });
    if (base.hand === null) throw new Error("hand must exist");
    const seating = base.hand.seating;
    const benchId = base.order.find(
      (id) => seatOfPlayer(seating, id) === null,
    ) as PlayerId;

    // 抜け番を単独最高にし、供託2本を場に残して南4親流れ流局 → gameEnd。
    const points = { p0: 25000, p1: 30000, p2: 31000, p3: 27000 };
    points[benchId] = 52000;
    const conclusion: RoundConclusion = {
      outcome: "dealerPasses",
      isDraw: true,
      summary: {
        kind: "draw",
        label: "流局(テンパイ0人)",
        deltas: { p0: 0, p1: 0, p2: 0, p3: 0 },
      },
    };
    const end = finishRound(
      {
        ...base,
        round: { ...base.round, wind: "south", roundNumber: 4 },
        points,
        riichiSticks: 2,
      },
      conclusion,
    );
    expect(end.phase).toBe("gameEnd");
    expect(end.lastRound?.residualSticks?.recipientId).toBe(benchId);

    const view = selectView(end);
    const benchSlot = Object.values(view.slots).find(
      (slot) => slot.kind === "bench",
    );
    expect(benchSlot).toBeDefined();
    if (benchSlot?.kind === "bench") {
      expect(benchSlot.player.pointsDelta).toBe(2000);
      expect(benchSlot.player.points).toBe(52000 + 2000);
    }
  });
});

describe("selectView 裏ドラ開示(#290)", () => {
  /** 決着サマリ(和了/流局)で局を締める共通ヘルパー。 */
  function concludeWith(
    seed: number,
    round: Pick<EngineState["round"], "wind" | "roundNumber">,
    summary: RoundConclusion["summary"],
    outcome: RoundConclusion["outcome"] = "dealerPasses",
  ) {
    const base = createGame({ seed });
    if (base.hand === null) throw new Error("hand must exist");
    return finishRound(
      { ...base, round: { ...base.round, ...round } },
      { outcome, isDraw: summary.kind === "draw", summary },
    );
  }

  const riichiWinSummary: RoundConclusion["summary"] = {
    kind: "win",
    label: "リーチ和了",
    deltas: { p0: 8000, p1: -8000, p2: 0, p3: 0 },
    winnerId: "p0",
    riichiWin: true,
  };

  it("通常局(roundEnd)のリーチ和了では裏ドラ表示牌を開示する(従来挙動)", () => {
    const end = concludeWith(
      7,
      { wind: "east", roundNumber: 1 },
      riichiWinSummary,
    );
    expect(end.phase).toBe("roundEnd");
    if (end.hand === null) throw new Error("hand must exist");

    const dora = selectView(end).dora;
    expect(dora.uraIndicators).toBeDefined();
    expect(dora.uraIndicators).toHaveLength(
      end.hand.doraSet.uraIndicators.length,
    );
  });

  it("半荘最終局(gameEnd 直行)のリーチ和了でも裏ドラ表示牌を開示する", () => {
    // 南4・親流れ → roundEnd を経由せず gameEnd へ直行(#277)。
    const end = concludeWith(
      7,
      { wind: "south", roundNumber: 4 },
      riichiWinSummary,
    );
    expect(end.phase).toBe("gameEnd");
    expect(end.lastRound?.riichiWin).toBe(true);
    if (end.hand === null) throw new Error("hand must exist");

    const dora = selectView(end).dora;
    expect(dora.uraIndicators).toBeDefined();
    expect(dora.uraIndicators).toEqual(
      end.hand.doraSet.uraIndicators.map((t) => ({
        suit: t.suit,
        rank: t.rank,
        isRed: t.isRed,
      })),
    );
  });

  it("gameEnd 直行でもリーチでない和了なら裏ドラを伏せたまま(回帰なし)", () => {
    const end = concludeWith(
      7,
      { wind: "south", roundNumber: 4 },
      {
        ...riichiWinSummary,
        label: "面前和了(リーチなし)",
        riichiWin: false,
      },
    );
    expect(end.phase).toBe("gameEnd");
    expect(selectView(end).dora.uraIndicators).toBeUndefined();
  });

  it("gameEnd 直行の流局終局では裏ドラを伏せたまま(回帰なし)", () => {
    const end = concludeWith(
      7,
      { wind: "south", roundNumber: 4 },
      {
        kind: "draw",
        label: "流局(テンパイ0人)",
        deltas: { p0: 0, p1: 0, p2: 0, p3: 0 },
      },
    );
    expect(end.phase).toBe("gameEnd");
    expect(selectView(end).dora.uraIndicators).toBeUndefined();
  });
});

describe("selectView kita projection", () => {
  it("0/1/2/4枚の抜き北を全着席者の公開ビューへ写像する", () => {
    const zero = createGame({ seed: 0 });
    expect(zero.hand).not.toBeNull();
    if (zero.hand === null) return;
    zero.hand.kita = { east: 0, south: 0, west: 0 };
    const zeroView = selectView(zero);
    for (const position of ["self", "right", "across"] as const) {
      const slot = zeroView.slots[position];
      expect(slot.kind).toBe("seated");
      if (slot.kind === "seated") expect(slot.player.kitaCount).toBe(0);
    }

    const publicCounts = [
      { east: 1, south: 2, west: 4 },
      { east: 4, south: 1, west: 2 },
    ] as const;
    for (const counts of publicCounts) {
      zero.hand.kita = { ...counts };
      const view = selectView(zero);
      const expected = {
        self: counts.east,
        right: counts.south,
        across: counts.west,
      };
      for (const position of ["self", "right", "across"] as const) {
        const slot = view.slots[position];
        expect(slot.kind).toBe("seated");
        if (slot.kind === "seated") {
          expect(slot.player.kitaCount).toBe(expected[position]);
        }
      }
    }
  });
});

describe("selectView remaining wall projection(#189)", () => {
  it("配牌北の自動補充後の残り山をengineからそのまま写像する", () => {
    const game = createGame({ seed: 0 });
    expect(game.hand?.wall.remainingLiveTiles).toBe(52);
    expect(selectView(game).tableInfo.remainingLiveTiles).toBe(52);
  });

  it("通常ツモとカン/北抜きの嶺上補充による減少を反映する", () => {
    const game = createGame({ seed: 42 });
    const wall = game.hand?.wall;
    if (!wall) throw new Error("hand must exist");
    const initial = wall.remainingLiveTiles;

    wall.draw();
    expect(selectView(game).tableInfo.remainingLiveTiles).toBe(initial - 1);
    wall.drawReplacement();
    expect(selectView(game).tableInfo.remainingLiveTiles).toBe(initial - 2);
  });

  it("海底では残り山0を写像する", () => {
    const game = createGame({ seed: 99 });
    const wall = game.hand?.wall;
    if (!wall) throw new Error("hand must exist");
    while (wall.remainingLiveTiles > 0) wall.draw();

    expect(selectView(game).tableInfo.remainingLiveTiles).toBe(0);
  });
});
