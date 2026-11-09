import type { CharacterActorFrame } from "../characters3d/controller";
import { projectCharacterGeometry } from "../characters3d/project";
import type { CharacterMaterial } from "../characters3d/types";

export interface CharacterSurface {
  readonly id: string;
  readonly position: "self" | "left" | "across" | "right";
  readonly vertices: Float32Array;
  readonly material: CharacterMaterial;
}

/** Model units are metres. The single conversion keeps floor/pivots coherent. */
export const CHARACTER_METRES_TO_SCENE = 4;

export function projectCharacterSurfaces(
  actors: readonly CharacterActorFrame[],
): readonly CharacterSurface[] {
  if (
    actors.length !== 4 ||
    new Set(actors.map((actor) => actor.playerId)).size !== 4 ||
    new Set(actors.map((actor) => actor.position)).size !== 4
  )
    throw new TypeError("Expected four character actors in stable slots");
  return actors.flatMap((actor) =>
    projectCharacterGeometry(actor.model, actor.pose).map((batch) => {
      const material = actor.model.materials.find(
        (entry) => entry.id === batch.materialId,
      );
      if (!material) throw new TypeError("Missing character material binding");
      return {
        id: `${actor.playerId}/${batch.id}`,
        position: actor.position,
        vertices: batch.vertices,
        material,
      };
    }),
  );
}

/** Seated actors face the table. Bench retains its physical slot. */
export function characterPlacement(position: CharacterSurface["position"]) {
  const radius = 15.5;
  const placements = {
    self: { center: [0, -3, radius], yaw: Math.PI },
    left: { center: [-radius, -3, 0], yaw: Math.PI / 2 },
    across: { center: [0, -3, -radius], yaw: 0 },
    right: { center: [radius, -3, 0], yaw: -Math.PI / 2 },
  } as const;
  return placements[position];
}
