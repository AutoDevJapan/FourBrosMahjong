import { selectView } from "@/components/game/gameView";
import { createGame } from "@/domain/game/engine";
import type { SlotContent } from "@/domain/game/viewTypes";
import contract from "../../documents/fixtures/unity-display-contract.json";

const SEAT_KEYS = ["east", "south", "west", "bench"] as const;
const PLAYER_IDS = ["p0", "p1", "p2", "p3"] as const;
const VIEW_SLOT_KEYS = ["self", "left", "across", "right"] as const;
type SeatKey = (typeof SEAT_KEYS)[number];
type FixturePlayerId = (typeof PLAYER_IDS)[number];
type SeatMap = Record<SeatKey, FixturePlayerId>;
type PointsByPlayer = Record<FixturePlayerId, number>;
type ViewSlotKey = (typeof VIEW_SLOT_KEYS)[number];

interface DisplaySlotFixture {
  readonly kind: "seated" | "bench";
  readonly playerId: FixturePlayerId;
  readonly points: number;
  readonly seatWind?: "east" | "south" | "west";
}

type DisplaySlotShape = Record<ViewSlotKey, DisplaySlotFixture>;

interface RotationCase {
  readonly name: string;
  readonly before: SeatMap;
  readonly after: SeatMap;
}

interface ProgressionCase {
  readonly name: string;
  readonly outcome: "dealerContinues" | "dealerPasses";
  readonly beforeRound: RoundPosition;
  readonly afterRound: RoundPosition;
  readonly beforeSeats: SeatMap;
  readonly afterSeats: SeatMap;
  readonly beforePoints: PointsByPlayer;
  readonly afterPoints: PointsByPlayer;
  readonly pointsRemainWithPlayer: boolean;
}

interface RoundPosition {
  readonly wind: "east" | "south";
  readonly handNumber: number;
  readonly honba: number;
}

interface ContractFixture {
  readonly schema: string;
  readonly schemaVersion: number;
  readonly source: {
    readonly messageTypes: readonly string[];
    readonly snapshotVersion: number;
    readonly ruleAuthority: string;
    readonly displayAuthority: string;
  };
  readonly rotationCases: readonly RotationCase[];
  readonly progressionCases: readonly ProgressionCase[];
  readonly visualCases: readonly {
    readonly id: string;
    readonly sourceComponent: string;
    readonly assertions: Record<string, unknown> & {
      readonly slotShape?: DisplaySlotShape;
    };
  }[];
  readonly negativeCases: readonly string[];
}

const fixture = contract as ContractFixture;

function expectedRotation(before: SeatMap): SeatMap {
  return {
    east: before.south,
    south: before.west,
    west: before.bench,
    bench: before.east,
  };
}

function expectSeatMap(map: SeatMap) {
  expect(Object.keys(map).sort()).toEqual([...SEAT_KEYS].sort());
  expect(Object.values(map).sort()).toEqual([...PLAYER_IDS].sort());
}

function expectPointMap(points: PointsByPlayer) {
  expect(Object.keys(points).sort()).toEqual([...PLAYER_IDS].sort());
  for (const playerId of PLAYER_IDS) {
    expect(typeof points[playerId]).toBe("number");
    expect(Number.isFinite(points[playerId])).toBe(true);
  }
}

function expectPointsRemainWithPlayer(
  before: PointsByPlayer,
  after: PointsByPlayer,
) {
  expectPointMap(before);
  expectPointMap(after);
  for (const playerId of PLAYER_IDS) {
    expect(after[playerId]).toBe(before[playerId]);
  }
}

function expectDisplaySlotShape(shape: DisplaySlotShape) {
  expect(Object.keys(shape).sort()).toEqual([...VIEW_SLOT_KEYS].sort());

  const slots = VIEW_SLOT_KEYS.map((position) => shape[position]);
  expect(slots).toHaveLength(4);
  expect(slots.filter((slot) => slot.kind === "seated")).toHaveLength(3);
  expect(slots.filter((slot) => slot.kind === "bench")).toHaveLength(1);
  expect(slots.map((slot) => slot.playerId).sort()).toEqual(
    [...PLAYER_IDS].sort(),
  );

  const seated = slots.filter((slot) => slot.kind === "seated");
  expect(seated.map((slot) => slot.seatWind).sort()).toEqual([
    "east",
    "south",
    "west",
  ]);
  for (const slot of slots) {
    expect(typeof slot.points).toBe("number");
    expect(Number.isFinite(slot.points)).toBe(true);
    if (slot.kind === "bench") {
      expect(slot).not.toHaveProperty("seatWind");
    }
  }
}

function displaySlotFixtureOf(slot: SlotContent): DisplaySlotFixture {
  if (slot.kind === "seated") {
    return {
      kind: "seated",
      playerId: slot.player.playerId,
      points: slot.player.points,
      seatWind: slot.player.seatWind,
    };
  }
  return {
    kind: "bench",
    playerId: slot.player.playerId,
    points: slot.player.points,
  };
}

function displaySlotShapeOf(
  view: ReturnType<typeof selectView>,
): DisplaySlotShape {
  return {
    self: displaySlotFixtureOf(view.slots.self),
    left: displaySlotFixtureOf(view.slots.left),
    across: displaySlotFixtureOf(view.slots.across),
    right: displaySlotFixtureOf(view.slots.right),
  };
}

describe("Unity display contract fixture", () => {
  it("identifies a versioned, view-only online source", () => {
    expect(fixture.schema).toBe(
      "com.autodevjapan.four-bros-mahjong/unity-display",
    );
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.source.messageTypes).toEqual(["session", "snapshot"]);
    expect(fixture.source.snapshotVersion).toBe(42);
    expect(fixture.source.ruleAuthority).toBe("server-and-domain");
    expect(fixture.source.displayAuthority).toBe("unity-client");
  });

  it("keeps all four parent-flow rotations as three-seated/one-bench maps", () => {
    expect(fixture.rotationCases).toHaveLength(4);
    expect(fixture.rotationCases.map((rotation) => rotation.name)).toEqual([
      "east-1",
      "east-2",
      "east-3",
      "east-4-to-south-1",
    ]);

    for (const [index, rotation] of fixture.rotationCases.entries()) {
      expectSeatMap(rotation.before);
      expectSeatMap(rotation.after);
      expect(rotation.after).toEqual(expectedRotation(rotation.before));

      const next =
        fixture.rotationCases[(index + 1) % fixture.rotationCases.length];
      if (next === undefined)
        throw new Error("next rotation fixture is missing");
      expect(next.before).toEqual(rotation.after);
    }
  });

  it("fixes renchan and east-4 to south-1 progression boundaries", () => {
    expect(fixture.progressionCases).toHaveLength(2);

    const renchan = fixture.progressionCases[0];
    if (renchan === undefined) throw new Error("renchan fixture is missing");
    expectSeatMap(renchan.beforeSeats);
    expectSeatMap(renchan.afterSeats);
    expectPointsRemainWithPlayer(renchan.beforePoints, renchan.afterPoints);
    expect(renchan).toMatchObject({
      name: "renchan-keeps-seats",
      outcome: "dealerContinues",
      beforeRound: { wind: "east", handNumber: 1, honba: 0 },
      afterRound: { wind: "east", handNumber: 1, honba: 1 },
      pointsRemainWithPlayer: true,
    });
    expect(renchan?.afterSeats).toEqual(renchan?.beforeSeats);

    const windChange = fixture.progressionCases[1];
    if (windChange === undefined)
      throw new Error("wind-change fixture is missing");
    expectSeatMap(windChange.beforeSeats);
    expectSeatMap(windChange.afterSeats);
    expectPointsRemainWithPlayer(
      windChange.beforePoints,
      windChange.afterPoints,
    );
    expect(windChange).toMatchObject({
      name: "east-4-to-south-1",
      outcome: "dealerPasses",
      beforeRound: { wind: "east", handNumber: 4, honba: 0 },
      afterRound: { wind: "south", handNumber: 1, honba: 0 },
      pointsRemainWithPlayer: true,
    });
    expect(windChange.afterSeats).toEqual(
      expectedRotation(windChange.beforeSeats),
    );
  });

  it("covers the display-only visual cases without importing game decisions", () => {
    expect(fixture.visualCases.map((item) => item.id)).toEqual([
      "river-wrap-and-riichi",
      "hand-deal-draw-replacement-meld",
      "major-effects",
      "bench-warmers",
    ]);

    const river = fixture.visualCases[0];
    if (river === undefined) throw new Error("river fixture is missing");
    expect(river.sourceComponent).toBe("Discards");
    expect(river.assertions).toMatchObject({
      directionalSlot: "self-left-across-right",
      gridWrap: true,
      riichiTileIsSideways: true,
      discardOrderIsPreserved: true,
    });

    const hand = fixture.visualCases[1];
    if (hand === undefined) throw new Error("hand fixture is missing");
    expect(hand.sourceComponent).toBe("HandTileAnimation");
    expect(hand.assertions.transitionKinds).toEqual([
      "deal",
      "draw",
      "replacement",
      "meld",
    ]);
    expect(hand.assertions).toMatchObject({
      drawEntranceDurationMs: 200,
      dealDelayIsDeterministic: true,
      tileOrderIsNotUsedForDomainDecisions: true,
    });

    const effects = fixture.visualCases[2];
    if (effects === undefined) throw new Error("effects fixture is missing");
    expect(effects.sourceComponent).toBe("gameEffect");
    expect(effects.assertions.kinds).toEqual([
      "discard",
      "riichi",
      "pon",
      "kan",
      "tsumo",
      "ron",
      "draw",
      "roundEnd",
    ]);
    expect(effects.assertions).toMatchObject({
      effectIsDerivedFromCommittedView: true,
      resolutionIsAssertive: true,
    });

    const bench = fixture.visualCases[3];
    if (bench === undefined) throw new Error("bench fixture is missing");
    expect(bench.sourceComponent).toBe("PlayerSlot");
    expect(bench.assertions).toMatchObject({
      slotCount: 4,
      seatedCount: 3,
      benchCount: 1,
      benchHasNoSeatWind: true,
      pointsRemainWithPlayer: true,
    });
    if (bench.assertions.slotShape === undefined)
      throw new Error("bench slot shape is missing");
    expectDisplaySlotShape(bench.assertions.slotShape);

    expect(fixture.negativeCases).toEqual(
      expect.arrayContaining([
        expect.stringContaining("legal actions"),
        expect.stringContaining("license"),
        expect.stringContaining("snapshot version"),
        expect.stringContaining("credentials"),
      ]),
    );
  });

  it("anchors the fixture to selectView's three-seated/one-bench slot shape", () => {
    const bench = fixture.visualCases.find(
      (item) => item.id === "bench-warmers",
    );
    if (bench === undefined) throw new Error("bench fixture is missing");
    if (bench.assertions.slotShape === undefined)
      throw new Error("bench slot shape is missing");

    const view = selectView(createGame({ seed: 827 }));
    const slots = Object.values(view.slots);
    expect(slots).toHaveLength(4);
    expect(slots.filter((slot) => slot.kind === "seated")).toHaveLength(3);
    expect(slots.filter((slot) => slot.kind === "bench")).toHaveLength(1);

    const benchSlot = slots.find((slot) => slot.kind === "bench");
    if (benchSlot === undefined) throw new Error("view bench slot is missing");
    expect(benchSlot.player).not.toHaveProperty("seatWind");

    const actualShape = displaySlotShapeOf(view);
    expectDisplaySlotShape(actualShape);
    expect(actualShape).toEqual(bench.assertions.slotShape);
  });
});
