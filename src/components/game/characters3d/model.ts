import {
  CHARACTER_PROFILES,
  type CharacterPlayerId,
  isCharacterPlayerId,
} from "@/domain/game/characters";
import { connectedClothing } from "./connected-body";
import { buildCharacterMeshes } from "./geometry";
import { MODEL_PROFILES } from "./profiles";
import { createRig } from "./rig";
import type { CharacterModel, V3 } from "./types";

/** Pure data factory. Caller owns caching; importing this file creates nothing. */
export function createCharacterModel(id: CharacterPlayerId): CharacterModel {
  if (!isCharacterPlayerId(id)) throw new TypeError("Unknown character ID");
  const p = MODEL_PROFILES[id],
    bones = createRig(p),
    meshes = [...buildCharacterMeshes(p, bones), connectedClothing(p, bones)];
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes)
    for (let i = 0; i < mesh.vertices.length; i += 8)
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], mesh.vertices[i + axis]);
        max[axis] = Math.max(max[axis], mesh.vertices[i + axis]);
      }
  const path = `documents/assets/characters/originals/${p.source}`;
  return {
    id,
    name: CHARACTER_PROFILES[id].defaultName,
    status: "unapproved-candidate",
    skeletonId: "fourbros-seated-v1",
    source: { path, sha256: p.sha256 },
    height: p.height,
    bones,
    meshes,
    bounds: { min: min as unknown as V3, max: max as unknown as V3 },
    materials: [
      {
        id: "reference",
        color: [1, 1, 1],
        roughness: 0.38,
        metallic: 0,
        texture: `src/components/game/characters3d/textures/${id}-reference.jpg`,
        textureOrigin: "top-left",
      },
      { id: "skin", color: p.skinColor, roughness: 0.68, metallic: 0 },
      { id: "rib", color: [0.023, 0.026, 0.028], roughness: 0.86, metallic: 0 },
      { id: "hair", color: p.hairColor, roughness: 0.48, metallic: 0 },
      {
        id: "hair-highlight",
        color: p.hairColor.map((c) => c * 1.45 + 0.012) as unknown as V3,
        roughness: 0.37,
        metallic: 0,
      },
      { id: "accent", color: p.accent, roughness: 0.5, metallic: 0 },
      {
        id: "silver",
        color: [0.52, 0.55, 0.56],
        roughness: 0.25,
        metallic: 0.85,
      },
      { id: "sole", color: [0.69, 0.68, 0.58], roughness: 0.91, metallic: 0 },
    ],
    sockets: {
      root: { bone: "root", offset: [0, 0, 0] },
      hips: { bone: "hips", offset: [0, 0, 0] },
      head: { bone: "head", offset: [0, 0.15, 0] },
      back: { bone: "chest", offset: [0, 0, -p.depth] },
      "left-hand": { bone: "hand.L", offset: [0, -0.07, 0.02] },
      "right-hand": { bone: "hand.R", offset: [0, -0.07, 0.02] },
      "left-foot": {
        bone: "foot.L",
        offset: [0, -0.105 * (p.height / 1.75), 0.055],
      },
      "right-foot": {
        bone: "foot.R",
        offset: [0, -0.105 * (p.height / 1.75), 0.055],
      },
    },
  };
}
