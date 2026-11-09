import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DisplayEnvelope } from "@/domain/display/displaySnapshot";
import { TILE_ASSET_URLS } from "../../common/tileImage";
import { projectScene, type SceneGroup, TILE_TEXTURE_URLS } from "./scene";

import { frame } from "./sceneFixture";

describe("public display scene", () => {
  it("projects supplied seats, own faces and counted hidden opponents without mutation", () => {
    const source = frame();
    const original = structuredClone(source);
    const scene = projectScene(source);
    expect(source).toEqual(original);
    expect(
      scene.slots.map((slot) => [slot.position, slot.playerId, slot.kind]),
    ).toEqual(
      source.snapshot.slots.map((slot) => [
        slot.position,
        slot.playerId,
        slot.kind,
      ]),
    );
    const own = scene.tiles.filter(
      (tile) => tile.group === "hand" && tile.position === "self",
    );
    expect(own.map((tile) => tile.face)).toEqual([
      "/tiles/Pin5-Dora.svg",
      "/tiles/Sou5.svg",
      "/tiles/Pin5-Dora.svg",
    ]);
    expect(own.map((tile) => tile.optionId)).toEqual([
      "red-first",
      null,
      "red-second",
    ]);
    expect(own[0].optionIds).toContain("red-riichi");
    const hidden = scene.tiles.filter(
      (tile) => tile.group === "hand" && tile.position !== "self",
    );
    expect(hidden).toHaveLength(20);
    expect(
      hidden.every((tile) => tile.face === null && tile.optionId === null),
    ).toBe(true);
    expect(scene.tiles.some((tile) => tile.position === "right")).toBe(false);
    expect(new Set(scene.tiles.map((tile) => tile.id)).size).toBe(
      scene.tiles.length,
    );
  });

  it("lays out four physical directions and retains river order, riichi, melds, kita and dora", () => {
    const scene = projectScene(frame());
    const river = scene.tiles.filter((tile) => tile.group === "discards");
    expect(river.map((tile) => tile.face)).toEqual([
      "/tiles/Man1.svg",
      "/tiles/Pei.svg",
    ]);
    expect(river[0].rotation[1]).toBe(0);
    expect(river[1].rotation[1]).toBeCloseTo(Math.PI / 2);
    expect(river[0].center[2]).toBeGreaterThan(0);
    const left = scene.tiles.find((tile) => tile.position === "left")!;
    const across = scene.tiles.find((tile) => tile.position === "across")!;
    expect(left.center[0]).toBeLessThan(-8);
    expect(across.center[2]).toBeLessThan(-8);
    expect(
      scene.tiles
        .filter((tile) => tile.group === "melds")
        .map((tile) => tile.face),
    ).toEqual([
      "/tiles/Sou9.svg",
      "/tiles/Sou9.svg",
      "/tiles/Sou9.svg",
      null,
      "/tiles/Pin1.svg",
      "/tiles/Pin1.svg",
      null,
    ]);
    expect(
      scene.tiles
        .filter((tile) => tile.group === "kita")
        .map((tile) => tile.face),
    ).toEqual(["/tiles/Pei.svg", "/tiles/Pei.svg"]);
    expect(
      scene.tiles
        .filter((tile) => tile.group === "dora")
        .map((tile) => tile.face),
    ).toEqual(["/tiles/Pin5-Dora.svg", null]);
  });

  it("filters geometry by group while retaining slot/overlay anchors", () => {
    const groups: SceneGroup[] = ["table", "discards", "melds", "kita", "dora"];
    const scene = projectScene(frame(), groups);
    expect(scene.tiles.length).toBeGreaterThan(0);
    expect(scene.tiles.some((tile) => tile.group === "hand")).toBe(false);
    expect(scene.solids.length).toBeGreaterThan(0);
    expect(scene.slots).toHaveLength(4);
    expect(projectScene(frame(), []).tiles).toEqual([]);
    expect(projectScene(frame(), []).solids).toEqual([]);
  });

  it("separates the committed drawn tile without changing domain hand order", () => {
    const source = frame();
    const self = source.snapshot.slots[0];
    if (self.kind !== "seated" || !("hand" in self))
      throw new Error("self hand missing");
    Object.assign(self, { drawnIndex: 0 });
    const scene = projectScene(source);
    const hand = scene.tiles.filter(
      (tile) => tile.group === "hand" && tile.position === "self",
    );
    expect(hand.map((tile) => tile.id)).toEqual([
      "self/hand/1",
      "self/hand/2",
      "self/hand/0",
    ]);
    expect(hand.at(-1)!.center[0] - hand.at(-2)!.center[0]).toBeCloseTo(1.47);
    expect(self.hand[0]).toEqual({ suit: "pin", rank: 5, red: true });
  });

  it("replaces the full scene on bench/seat changes and restore without carrying cues", () => {
    const first = frame();
    const scene = projectScene(first);
    const next = structuredClone(first);
    next.snapshot.slots = next.snapshot.slots.map((slot) =>
      slot.position === "self"
        ? { ...next.snapshot.slots[3], position: "self", playerId: "p0" }
        : slot.position === "right"
          ? {
              ...next.snapshot.slots[0],
              position: "right",
              playerId: "p3",
              handCount: 3,
            }
          : slot,
    );
    const restored = projectScene({ ...next, revision: 15, mode: "restore" });
    expect(restored.tiles.some((tile) => tile.position === "self")).toBe(false);
    const rightHand = restored.tiles.filter(
      (tile) => tile.position === "right" && tile.group === "hand",
    );
    expect(rightHand).toHaveLength(3);
    expect(
      rightHand.every((tile) => tile.face === null && tile.center[0] > 8),
    ).toBe(true);
    expect(projectScene({ ...first, mode: "live" })).toEqual(scene);
  });

  it("does not retain injected hidden faces, bench fields or nested metadata", () => {
    const source = frame();
    for (const slot of source.snapshot.slots) {
      if (slot.position !== "self") {
        Object.assign(slot, {
          hand: [{ suit: "man", rank: 8, red: false, secret: "PRIVATE" }],
        });
      }
      Object.assign(slot, { engine: "PRIVATE", wall: "PRIVATE" });
    }
    Object.assign(source.snapshot.slots[3], {
      kitaCount: 999,
      discards: ["PRIVATE"],
    });
    Object.assign(source.snapshot.dora, {
      uraIndicators: [{ suit: "sou", rank: 8, red: false }],
    });
    const scene = projectScene(source);
    expect(JSON.stringify(scene)).not.toContain("PRIVATE");
    expect(
      scene.tiles
        .filter((tile) => tile.group === "dora")
        .map((tile) => tile.face),
    ).toEqual(["/tiles/Pin5-Dora.svg", null]);
  });

  it("uses every existing CC0 texture, including both red fives, with no missing URL", () => {
    expect([...TILE_TEXTURE_URLS].sort()).toEqual([...TILE_ASSET_URLS].sort());
    expect(TILE_TEXTURE_URLS).toHaveLength(30);
    const files = readdirSync("public/tiles").filter((file) =>
      file.endsWith(".svg"),
    );
    expect(TILE_TEXTURE_URLS.map((url) => url.slice(7)).sort()).toEqual(
      files.sort(),
    );
    for (const url of TILE_TEXTURE_URLS) {
      expect(readFileSync(`public${url}`, "utf8")).toContain("<svg");
    }
  });

  it.each([
    (f: DisplayEnvelope) => Object.assign(f, { version: 2 }),
    (f: DisplayEnvelope) => Object.assign(f, { revision: Number.NaN }),
    (f: DisplayEnvelope) =>
      Object.assign(f.snapshot.slots[1], { handCount: 100000 }),
    (f: DisplayEnvelope) =>
      Object.assign(f.snapshot.slots[0], {
        hand: [{ suit: "man", rank: 8, red: false }],
      }),
    (f: DisplayEnvelope) =>
      Object.assign(f.snapshot.slots[1], { playerId: "p0" }),
  ])(
    "rejects invalid DTO/resource boundaries before creating geometry",
    (mutate) => {
      const source = frame();
      mutate(source);
      expect(() => projectScene(source)).toThrow();
    },
  );
});
