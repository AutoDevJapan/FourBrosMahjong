import contract from "../../documents/fixtures/unity-display-contract.json";

const SEAT_KEYS = ["east", "south", "west", "bench"] as const;
const PLAYER_IDS = ["p0", "p1", "p2", "p3"] as const;
type SeatKey = (typeof SEAT_KEYS)[number];
type SeatMap = Record<SeatKey, string>;

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
    readonly assertions: Record<string, unknown>;
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

describe("Unity display contract fixture", () => {
  it("identifies a versioned, view-only online source", () => {
    expect(fixture.schema).toBe(
      "com.autodevjapan.four-bros-mahjong/unity-display",
    );
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.source.messageTypes).toEqual(["session", "snapshot"]);
    expect(fixture.source.snapshotVersion).toBeGreaterThan(0);
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
      if (next === undefined) throw new Error("next rotation fixture is missing");
      expect(next.before).toEqual(rotation.after);
    }
  });

  it("fixes renchan and east-4 to south-1 progression boundaries", () => {
    expect(fixture.progressionCases).toHaveLength(2);

    const renchan = fixture.progressionCases[0];
    if (renchan === undefined) throw new Error("renchan fixture is missing");
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
    expect(river.assertions).toMatchObject({
      directionalSlot: "self-left-across-right",
      gridWrap: true,
      riichiTileIsSideways: true,
      discardOrderIsPreserved: true,
    });

    const hand = fixture.visualCases[1];
    if (hand === undefined) throw new Error("hand fixture is missing");
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
    expect(bench.assertions).toMatchObject({
      slotCount: 4,
      seatedCount: 3,
      benchCount: 1,
      benchHasNoSeatWind: true,
      pointsRemainWithPlayer: true,
    });

    expect(fixture.negativeCases).toEqual(
      expect.arrayContaining([
        expect.stringContaining("legal actions"),
        expect.stringContaining("license"),
        expect.stringContaining("snapshot version"),
        expect.stringContaining("credentials"),
      ]),
    );
  });
});
