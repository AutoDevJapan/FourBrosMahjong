import { describe, expect, it } from "vitest";
import type { Meld } from "@/domain/hand/meld";
import { parseTile, parseTiles } from "@/domain/hand/notation";
import {
  createGame,
  declareKan,
  declarePon,
  declareRon,
  declareTsumo,
  type Pending,
} from "./engine";

const pon = (notation: string): Meld => ({
  type: "pon",
  tiles: parseTiles(notation),
  concealed: false,
});

/** Crafted fourth-wind call, independently of natural seed reachability. */
function fourthWindCall(call: "pon" | "kan") {
  const initial = createGame({ seed: 41 });
  const state = {
    ...initial,
    round: { ...initial.round, honba: 2 },
    points: { p0: 30000, p1: 60000, p2: 40000, p3: 10000 },
  };
  const hand = state.hand;
  if (hand === null) throw new Error("hand required");
  hand.melds.east = [pon("1z 1z 1z"), pon("2z 2z 2z"), pon("4z 4z 4z")];
  hand.hands.east = parseTiles(call === "pon" ? "3z 3z 2s 9p" : "3z 3z 3z 9p");
  hand.drawn = null;
  hand.turn = "south";
  hand.pendingDiscard = {
    seat: "south",
    tile: parseTile("3z"),
    haitei: false,
  };
  const pending: Pending = {
    kind: "humanReact",
    tile: parseTile("3z"),
    from: "south",
    canRon: false,
    canPon: true,
    canKan: call === "kan",
  };
  return call === "pon"
    ? declarePon({ ...state, pending })
    : declareKan({ ...state, pending });
}

describe.each(["pon", "kan"] as const)("大四喜の実対局結線: %s", (call) => {
  it.each([
    {
      win: "ron" as const,
      discarder: "west" as const,
      label: "別の放銃者と折半し本場は放銃者が負担する",
      deltas: { p0: 48600, p1: -24000, p2: -24600, p3: 0 },
    },
    {
      win: "ron" as const,
      discarder: "south" as const,
      label: "責任者自身の放銃では本場込み全額を負担する",
      deltas: { p0: 48600, p1: -48600, p2: 0, p3: 0 },
    },
    {
      win: "tsumo" as const,
      discarder: null,
      label: "ツモでは責任者が本場込み全額を負担する",
      deltas: { p0: 48600, p1: -48600, p2: 0, p3: 0 },
    },
  ])("$label", ({ win, discarder, deltas }) => {
    const called = fourthWindCall(call);
    const hand = called.hand;
    if (hand === null) throw new Error("hand required");
    expect(called.phase).toBe("playing");
    expect(hand.melds.east).toHaveLength(4);
    expect(hand.melds.east[3]?.type).toBe(call);
    expect(hand.paoResponsible).toEqual({ east: { daisuushii: "p1" } });

    // Stage the later winning turn, as in engine.pao.test.ts. This is not a
    // natural full-hand walk and does not change the north-extraction policy.
    hand.hands.east = parseTiles("9p");
    hand.discards.east = [];
    const after =
      win === "tsumo"
        ? (() => {
            hand.turn = "east";
            hand.pendingDiscard = null;
            hand.drawn = { tile: parseTile("9p"), source: "live" };
            return declareTsumo({
              ...called,
              pending: {
                kind: "humanDiscard",
                canTsumo: true,
                canRiichi: false,
                riichiTiles: [],
                ankanTiles: [],
                kakanTiles: [],
                forbiddenDiscards: [],
                locked: false,
              },
            });
          })()
        : (() => {
            if (discarder === null) throw new Error("discarder required");
            hand.turn = discarder;
            hand.drawn = null;
            hand.pendingDiscard = {
              seat: discarder,
              tile: parseTile("9p"),
              haitei: false,
            };
            return declareRon({
              ...called,
              pending: {
                kind: "humanReact",
                tile: parseTile("9p"),
                from: discarder,
                canRon: true,
                canPon: false,
                canKan: false,
              },
            });
          })();

    expect(after.phase).toBe("roundEnd");
    expect(after.lastRound?.winnerId).toBe("p0");
    expect(
      after.lastRound?.winDetails?.yaku.some((yaku) => yaku.name === "大四喜"),
    ).toBe(true);
    expect(after.lastRound?.deltas).toEqual(deltas);
    expect(after.points).toEqual({
      p0: 30000 + deltas.p0,
      p1: 60000 + deltas.p1,
      p2: 40000 + deltas.p2,
      p3: 10000,
    });
    // The bench pays the bonus, but no pao points: Q14 remains separate.
    expect(after.bonus).toEqual({ p0: 3000, p1: -1000, p2: -1000, p3: -1000 });
  });
});
