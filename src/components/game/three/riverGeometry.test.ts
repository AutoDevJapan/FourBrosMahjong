import { describe, expect, it } from "vitest";
import { projectScene, type SceneTile } from "./scene";
import { frame } from "./sceneFixture";

function footprint(tile: SceneTile) {
  const yaw = tile.rotation[1];
  const x =
    (Math.abs(Math.cos(yaw)) * tile.size[0] +
      Math.abs(Math.sin(yaw)) * tile.size[2]) /
    2;
  const z =
    (Math.abs(Math.sin(yaw)) * tile.size[0] +
      Math.abs(Math.cos(yaw)) * tile.size[2]) /
    2;
  return {
    minX: tile.center[0] - x,
    maxX: tile.center[0] + x,
    minZ: tile.center[2] - z,
    maxZ: tile.center[2] + z,
  };
}

describe("river footprint packing", () => {
  for (const position of ["self", "left", "across", "right"] as const)
    it.each([-1, 0, 2, 5, 6, 17, 35, 39])(
      `${position} keeps a sideways riichi tile at row index %i clear of its neighbors`,
      (riichiIndex) => {
        const source = frame();
        if (position === "right") {
          source.snapshot.slots = source.snapshot.slots.map((slot) => {
            if (slot.position === "right")
              return {
                ...source.snapshot.slots[2],
                position: "right",
                playerId: "p3",
              };
            if (slot.position === "across")
              return {
                ...source.snapshot.slots[3],
                position: "across",
                playerId: "p2",
              };
            return slot;
          });
        }
        const slot = source.snapshot.slots.find(
          (item) => item.position === position,
        );
        if (!slot || slot.kind !== "seated")
          throw new Error("expected seated river");
        slot.discards = Array.from({ length: 40 }, (_, i) => ({
          suit: "pin" as const,
          rank: (i % 9) + 1,
          red: false,
          isRiichi: i === riichiIndex,
        }));
        const river = projectScene(source, ["discards"]).tiles.filter(
          (tile) => tile.position === position,
        );
        expect(river).toHaveLength(40);
        expect(new Set(river.map((tile) => tile.id)).size).toBe(40);
        expect(river.map((tile) => tile.face)).toEqual(
          Array.from({ length: 40 }, (_, i) => `/tiles/Pin${(i % 9) + 1}.svg`),
        );
        const bounds = river.map(footprint);
        for (let i = 0; i < bounds.length; i++)
          for (let j = i + 1; j < bounds.length; j++) {
            const a = bounds[i],
              b = bounds[j];
            const overlapX =
              Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
            const overlapZ =
              Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
            expect(
              overlapX > 1e-6 && overlapZ > 1e-6,
              `overlapping ${position} river tiles ${i} and ${j}`,
            ).toBe(false);
          }
      },
    );
});
