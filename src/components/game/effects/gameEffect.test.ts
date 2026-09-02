import { describe, expect, it } from "vitest";
import type { GamePhase, RoundSummary } from "@/domain/game/engine";
import type { Tile } from "@/domain/tiles/tile";
import type { GameViewState, MeldView } from "../types";
import {
  createGameEffectSnapshot,
  gameEffectForTransition,
} from "./gameEffect";

const tile: Tile = { suit: "pin", rank: 5, isRed: false };

function view(
  overrides: Partial<{
    selfRiichi: boolean;
    selfMelds: readonly MeldView[];
  }> = {},
): GameViewState {
  const self = {
    playerId: "p0" as const,
    name: "粗悪品",
    points: 35_000,
    seatWind: "east" as const,
    status: {
      hasDeclaredRiichi: overrides.selfRiichi ?? false,
    },
    kitaCount: 0,
    discards: [],
    ...(overrides.selfMelds ? { melds: overrides.selfMelds } : {}),
  };
  const opponent = (playerId: "p1" | "p2", name: string) => ({
    kind: "seated" as const,
    player: {
      playerId,
      name,
      points: 35_000,
      seatWind: playerId === "p1" ? ("south" as const) : ("west" as const),
      status: { hasDeclaredRiichi: false },
      handCount: 13,
      kitaCount: 0,
      discards: [],
    },
  });
  return {
    slots: {
      self: { kind: "seated", player: self },
      left: opponent("p1", "一郎"),
      across: opponent("p2", "竜二"),
      right: {
        kind: "bench",
        player: { playerId: "p3", name: "糸瓜", points: 35_000 },
      },
    },
    tableInfo: {
      roundWind: "east",
      handNumber: 1,
      honba: 0,
      riichiSticks: 0,
      remainingLiveTiles: 50,
      dice: [1, 2],
      doraCount: 1,
    },
    dora: { indicators: [tile], uraIndicatorCount: 1 },
    result: null,
  };
}

function snapshot(
  currentView: GameViewState,
  phase: GamePhase = "playing",
  summary: RoundSummary | null = null,
) {
  return createGameEffectSnapshot(currentView, phase, summary);
}

describe("gameEffectForTransition", () => {
  it("mount baselineでは過去のリーチを再生しない", () => {
    const current = snapshot(view({ selfRiichi: true }));
    expect(gameEffectForTransition(null, current, null)).toBeNull();
  });

  it("リーチ成立を自家名付きのpolite演出へ変換する", () => {
    const previous = snapshot(view());
    const current = snapshot(view({ selfRiichi: true }));

    expect(gameEffectForTransition(previous, current, null)).toMatchObject({
      kind: "riichi",
      title: "リーチ",
      announcement: "粗悪品がリーチを宣言しました。",
      assertive: false,
    });
  });

  it("局替わり後は前局のリーチ状態に関係なく新局のリーチを演出する", () => {
    const previousView = view({ selfRiichi: true });
    const currentView = {
      ...view({ selfRiichi: true }),
      tableInfo: { ...previousView.tableInfo, handNumber: 2 },
    };
    const previous = snapshot(previousView, "roundEnd");
    const current = snapshot(currentView);

    expect(gameEffectForTransition(previous, current, null)).toMatchObject({
      kind: "riichi",
      announcement: "粗悪品がリーチを宣言しました。",
      assertive: false,
    });
  });

  it("新しいポンとポンからカンへの変化を区別する", () => {
    const pon = {
      type: "pon" as const,
      tiles: [tile, tile, tile],
      concealed: false,
    };
    const kan = {
      type: "kan" as const,
      tiles: [tile, tile, tile, tile],
      concealed: false,
    };
    const previous = snapshot(view());
    const withPon = snapshot(view({ selfMelds: [pon] }));
    const withKan = snapshot(view({ selfMelds: [kan] }));

    expect(gameEffectForTransition(previous, withPon, null)).toMatchObject({
      kind: "pon",
      announcement: "粗悪品がポンしました。",
    });
    expect(gameEffectForTransition(withPon, withKan, null)).toMatchObject({
      kind: "kan",
      announcement: "粗悪品がカンしました。",
    });
  });

  it.each([
    ["tsumo", "ツモ"],
    ["ron", "ロン"],
  ] as const)("%s和了をassertiveな演出へ変換する", (winType, label) => {
    const summary: RoundSummary = {
      kind: "win",
      label: `粗悪品の${label} 3,900点`,
      deltas: { p0: 3_900, p1: -1_950, p2: -1_950, p3: 0 },
      winnerId: "p0",
      winDetails: {
        winType,
        dealer: true,
        winnerName: "粗悪品",
        winnerSeat: "east",
        hand: [tile],
        winningTile: tile,
        yaku: [],
        yakuHan: 0,
        dora: { omote: 0, ura: 0, aka: 0, gari: 0, total: 0 },
        totalHan: 0,
        yakuman: 0,
        category: "mangan",
        honba: 0,
        riichiSticks: 0,
        payments: [],
        stickPayout: 0,
      },
    };
    const previous = snapshot(view());
    const current = snapshot(view(), "roundEnd", summary);

    expect(gameEffectForTransition(previous, current, summary)).toMatchObject({
      kind: winType,
      title: label,
      assertive: true,
      announcement: `粗悪品の${label}和了。`,
    });
  });

  it("流局と半荘終了を結果系の演出として扱う", () => {
    const summary: RoundSummary = {
      kind: "draw",
      label: "流局(テンパイ1人)",
      deltas: { p0: 3_000, p1: -1_500, p2: -1_500, p3: 0 },
    };
    const previous = snapshot(view());
    const current = snapshot(view(), "gameEnd", summary);

    expect(gameEffectForTransition(previous, current, summary)).toMatchObject({
      kind: "draw",
      title: "流局",
      assertive: true,
      announcement: "流局。流局(テンパイ1人)。",
    });
  });

  it("結果サマリの再レンダーだけでは演出を繰り返さない", () => {
    const summary: RoundSummary = {
      kind: "draw",
      label: "流局(テンパイ0人)",
      deltas: { p0: 0, p1: 0, p2: 0, p3: 0 },
    };
    const current = snapshot(view(), "roundEnd", summary);

    expect(gameEffectForTransition(current, current, summary)).toBeNull();
  });
});
