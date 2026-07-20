import { describe, expect, it } from "vitest";
import { selectView } from "@/components/game/gameView";
import type { Meld } from "@/domain/hand/meld";
import { tileKey } from "@/domain/hand/tile-identity";
import type { Tile } from "@/domain/tiles/tile";
import { buildTileSet } from "@/domain/tiles/tileSet";
import {
  createGame,
  discard,
  type EngineState,
  passRon,
  proceedToNextRound,
  seatOfPlayer,
} from "./engine";

type AiAction = "riichi" | "pon" | "daiminkan" | "ankan" | "kakan";

function meldSignature(meld: Meld): string {
  return `${meld.type}:${meld.concealed}:${tileKey(meld.tiles[0])}`;
}

/** エンジンの全配置領域を集計し、北抜きを含む108枚の多重集合保存を検証する。 */
function expectTileConservation(state: EngineState): void {
  const hand = state.hand;
  if (hand === null) return;
  const actual: Tile[] = [
    ...hand.wall.liveWall,
    ...hand.wall.deadWall,
    ...Object.values(hand.hands).flat(),
    ...Object.values(hand.melds).flatMap((melds) =>
      melds.flatMap((meld) => [...meld.tiles]),
    ),
    ...Object.values(hand.discards).flat(),
    ...(hand.drawn ? [hand.drawn] : []),
  ];
  for (const count of Object.values(hand.kita)) {
    for (let i = 0; i < count; i++) {
      actual.push({ suit: "honor", rank: 4, isRed: false });
    }
  }
  const signature = (tiles: readonly Tile[]): string[] =>
    tiles
      .map((tile) => `${tileKey(tile)}:${tile.isRed ? "red" : "normal"}`)
      .sort();
  expect(actual).toHaveLength(108);
  expect(signature(actual)).toEqual(signature(buildTileSet()));
}

/** 自家は合法牌を切り、鳴き/ロンを見送ってAIの自動判断を観測する決定的ドライバ。 */
function observeAiActions(
  seed: number,
  wanted: readonly AiAction[],
): EngineState {
  let state = createGame({ seed });
  const observed = new Set<AiAction>();

  for (let guard = 0; guard < 3000 && state.phase !== "gameEnd"; guard++) {
    expectTileConservation(state);
    const before = state.hand
      ? {
          riichi: { ...state.hand.riichi },
          melds: Object.fromEntries(
            (["east", "south", "west"] as const).map((seat) => [
              seat,
              state.hand?.melds[seat].map(meldSignature) ?? [],
            ]),
          ) as Record<"east" | "south" | "west", string[]>,
        }
      : null;

    if (state.phase === "roundEnd") {
      state = proceedToNextRound(state);
      continue;
    }
    if (state.pending?.kind === "humanReact") {
      state = passRon(state);
    } else if (state.pending?.kind === "humanDiscard") {
      const hand = state.hand;
      const seat = hand ? seatOfPlayer(hand.seating, "p0") : null;
      if (hand === null || seat === null) break;
      const pool = [...hand.hands[seat], ...(hand.drawn ? [hand.drawn] : [])];
      const tile = pool.find(
        (candidate) =>
          !state.pending ||
          state.pending.kind !== "humanDiscard" ||
          !state.pending.forbiddenDiscards.some(
            (forbidden) => tileKey(forbidden) === tileKey(candidate),
          ),
      );
      if (tile === undefined) break;
      state = discard(state, tile);
    } else {
      break;
    }

    if (before === null || state.hand === null) continue;
    const humanSeat = seatOfPlayer(state.hand.seating, "p0");
    for (const seat of ["east", "south", "west"] as const) {
      if (seat === humanSeat) continue;
      if (!before.riichi[seat] && state.hand.riichi[seat]) {
        observed.add("riichi");
        expect(
          Object.entries(selectView(state).slots).some(
            ([position, slot]) =>
              position !== "self" &&
              slot.kind === "seated" &&
              slot.player.status?.hasDeclaredRiichi,
          ),
        ).toBe(true);
      }
      for (const meld of state.hand.melds[seat]) {
        const signature = meldSignature(meld);
        if (before.melds[seat].includes(signature)) continue;
        if (meld.type === "pon") observed.add("pon");
        if (meld.type === "kan" && meld.concealed) observed.add("ankan");
        if (meld.type === "kan" && !meld.concealed) {
          const wasPon = before.melds[seat].includes(
            `pon:false:${tileKey(meld.tiles[0])}`,
          );
          observed.add(wasPon ? "kakan" : "daiminkan");
        }
        expect(
          Object.entries(selectView(state).slots).some(
            ([position, slot]) =>
              position !== "self" &&
              slot.kind === "seated" &&
              (slot.player.melds?.length ?? 0) > 0,
          ),
        ).toBe(true);
      }
    }
    if (wanted.every((action) => observed.has(action))) break;
  }

  expect([...observed]).toEqual(expect.arrayContaining([...wanted]));
  expectTileConservation(state);
  return state;
}

describe("engine: AIのリーチ・鳴き・カン(#169)", () => {
  it("seed=22でAIがリーチ・役あり大明槓・暗槓し、GUI viewへ状態が投影される", () => {
    // seed は observeAiActions と同一ドライバのオフライン走査で選定(#294 で 1 → 22 へ再選定。
    // 副露向聴補正により AI の打牌が変わり、旧 seed=1 では3アクションが揃わなくなったため)。
    observeAiActions(22, ["riichi", "daiminkan", "ankan"]);
  });

  it("seed=7でAIが役ありポン・加槓し、牌保存則を維持する", () => {
    observeAiActions(7, ["pon", "kakan"]);
  });
});
