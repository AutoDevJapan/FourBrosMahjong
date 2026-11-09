import type { CharacterPlayerId } from "@/domain/game/characters";

export type V3 = readonly [number, number, number];
export type M4 = Float32Array;
export type BoneName =
  | "root"
  | "hips"
  | "spine"
  | "chest"
  | "neck"
  | "head"
  | "jaw"
  | "upperArm.L"
  | "forearm.L"
  | "hand.L"
  | "upperArm.R"
  | "forearm.R"
  | "hand.R"
  | "thigh.L"
  | "shin.L"
  | "foot.L"
  | "thigh.R"
  | "shin.R"
  | "foot.R";

export interface Bone {
  readonly name: BoneName;
  readonly parent: number;
  /** Absolute rest pivot in metres. Bind rotations are identity. */
  readonly pivot: V3;
  readonly inverseBind: M4;
}
export interface SkinMesh {
  readonly id: string;
  readonly materialId: string;
  /** Expanded triangles, xyz / normal xyz / uv, 32-byte stride. */
  readonly vertices: Float32Array;
  readonly joints: Uint16Array;
  readonly weights: Float32Array;
}
export interface CharacterMaterial {
  readonly id: string;
  readonly color: V3;
  readonly roughness: number;
  readonly metallic: number;
  readonly texture?: string;
  readonly textureOrigin?: "top-left";
}
export interface CharacterModel {
  readonly id: CharacterPlayerId;
  readonly name: string;
  readonly status: "unapproved-candidate";
  readonly skeletonId: "fourbros-seated-v1";
  readonly source: { readonly path: string; readonly sha256: string };
  readonly height: number;
  readonly bones: readonly Bone[];
  readonly meshes: readonly SkinMesh[];
  readonly materials: readonly CharacterMaterial[];
  readonly sockets: Readonly<Record<string, { bone: BoneName; offset: V3 }>>;
  readonly bounds: { readonly min: V3; readonly max: V3 };
}
export const CLIP_IDS = [
  "standing-reference",
  "seated-idle",
  "bench-idle",
  "deal",
  "draw",
  "discard",
  "declare",
  "call",
  "kita",
  "win-tsumo",
  "win-ron",
  "draw-round",
  "round-end",
] as const;
export type CharacterClipId = (typeof CLIP_IDS)[number];
export interface CharacterClip {
  readonly id: CharacterClipId;
  readonly duration: number;
  readonly loop: boolean;
  readonly rootMotion: "in-place";
  readonly contacts: readonly {
    readonly time: number;
    readonly socket: string;
    readonly role: string;
  }[];
}
export interface CharacterPose {
  readonly rotations: Readonly<Partial<Record<BoneName, V3>>>;
  readonly rootOffset: V3;
  readonly clipId: CharacterClipId;
  readonly finished: boolean;
}
export interface ProjectedCharacterBatch {
  readonly id: string;
  readonly materialId: string;
  readonly vertices: Float32Array;
}
