/** Deterministic glTF 2.0 binary export; no extra runtime dependency. */
import { CHARACTER_CLIPS, sampleCharacterPose } from "./clips";
import { rotation, sub } from "./matrix";
import type { CharacterModel, V3 } from "./types";

interface Accessor {
  bufferView: number;
  componentType: number;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
}
function quaternion(euler: V3): readonly [number, number, number, number] {
  const [a, b, c] = euler.map((v) => v / 2),
    cx = Math.cos(a),
    sx = Math.sin(a),
    cy = Math.cos(b),
    sy = Math.sin(b),
    cz = Math.cos(c),
    sz = Math.sin(c);
  return [
    sx * cy * cz - cx * sy * sz,
    cx * sy * cz + sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ];
}
export function exportCharacterGlb(
  model: CharacterModel,
  image: Uint8Array,
): Uint8Array {
  const chunks: Uint8Array[] = [],
    bufferViews: {
      buffer: number;
      byteOffset: number;
      byteLength: number;
      target?: 34962;
    }[] = [],
    accessors: Accessor[] = [];
  let offset = 0;
  const bytes = (value: Uint8Array, target?: 34962) => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      offset += pad;
    }
    const view = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset: offset,
      byteLength: value.byteLength,
      ...(target === undefined ? {} : { target }),
    });
    chunks.push(value);
    offset += value.byteLength;
    return view;
  };
  const attr = (
    value: Float32Array | Uint16Array,
    type: string,
    components: number,
    bounds = false,
    target?: 34962,
  ) => {
    const accessor: Accessor = {
      bufferView: bytes(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
        target,
      ),
      componentType: value instanceof Uint16Array ? 5123 : 5126,
      count: value.length / components,
      type,
    };
    if (bounds) {
      accessor.min = Array.from({ length: components }, (_, c) => {
        let v = Infinity;
        for (let i = c; i < value.length; i += components)
          v = Math.min(v, value[i]);
        return v;
      });
      accessor.max = Array.from({ length: components }, (_, c) => {
        let v = -Infinity;
        for (let i = c; i < value.length; i += components)
          v = Math.max(v, value[i]);
        return v;
      });
    }
    accessors.push(accessor);
    return accessors.length - 1;
  };
  const nodes: Record<string, unknown>[] = model.bones.map((bone, index) => {
    const children = model.bones
      .map((b, i) => (b.parent === index ? i : -1))
      .filter((i) => i >= 0);
    return {
      name: bone.name,
      translation:
        bone.parent < 0
          ? [0, 0, 0]
          : sub(bone.pivot, model.bones[bone.parent].pivot),
      ...(children.length ? { children } : {}),
    };
  });
  const materials = model.materials.map((mat) => ({
    name: mat.id,
    doubleSided: true,
    pbrMetallicRoughness: {
      baseColorFactor: [...mat.color, 1],
      metallicFactor: mat.metallic,
      roughnessFactor: mat.roughness,
      ...(mat.texture ? { baseColorTexture: { index: 0 } } : {}),
    },
  }));
  const primitives = model.meshes.map((mesh) => {
    const n = mesh.vertices.length / 8,
      pos = new Float32Array(n * 3),
      normal = new Float32Array(n * 3),
      uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      pos.set(mesh.vertices.subarray(i * 8, i * 8 + 3), i * 3);
      normal.set(mesh.vertices.subarray(i * 8 + 3, i * 8 + 6), i * 3);
      uv.set(mesh.vertices.subarray(i * 8 + 6, i * 8 + 8), i * 2);
    }
    // Padding joints have no influence; canonicalize only the exported copy.
    // Geometry/UV/weights and the model's authored joint array stay intact.
    const joints = Uint16Array.from(mesh.joints, (joint, i) =>
      mesh.weights[i] === 0 ? 0 : joint,
    );
    return {
      attributes: {
        POSITION: attr(pos, "VEC3", 3, true, 34962),
        NORMAL: attr(normal, "VEC3", 3, false, 34962),
        TEXCOORD_0: attr(uv, "VEC2", 2, false, 34962),
        ...(mesh.colors
          ? { COLOR_0: attr(mesh.colors, "VEC3", 3, false, 34962) }
          : {}),
        JOINTS_0: attr(joints, "VEC4", 4, false, 34962),
        WEIGHTS_0: attr(mesh.weights, "VEC4", 4, false, 34962),
      },
      ...(model.meshes.some((m) => m.handClosure)
        ? {
            targets: [
              {
                POSITION: attr(
                  mesh.handClosure?.positions ?? new Float32Array(n * 3),
                  "VEC3",
                  3,
                  true,
                  34962,
                ),
                NORMAL: attr(
                  mesh.handClosure?.normals ?? new Float32Array(n * 3),
                  "VEC3",
                  3,
                  false,
                  34962,
                ),
              },
            ],
          }
        : {}),
      material: model.materials.findIndex((mat) => mat.id === mesh.materialId),
      mode: 4,
    };
  });
  const inverseBind = new Float32Array(model.bones.length * 16);
  model.bones.forEach((bone, i) => inverseBind.set(bone.inverseBind, i * 16));
  const inverseBindMatrices = attr(inverseBind, "MAT4", 16),
    imageView = bytes(image);
  const animations = Object.values(CHARACTER_CLIPS).map((clip) => {
    const count = Math.ceil(clip.duration * 30) + 1,
      times = Float32Array.from(
        { length: count },
        (_, i) => (i * clip.duration) / (count - 1),
      );
    const time = attr(times, "SCALAR", 1, true),
      samplers: unknown[] = [],
      channels: unknown[] = [];
    for (let b = 0; b < model.bones.length; b++) {
      const rotations = new Float32Array(count * 4);
      for (let i = 0; i < count; i++)
        rotations.set(
          quaternion(
            sampleCharacterPose(model, clip.id, times[i]).rotations[
              model.bones[b].name
            ] ?? [0, 0, 0],
          ),
          i * 4,
        );
      samplers.push({
        input: time,
        output: attr(rotations, "VEC4", 4),
        interpolation: "LINEAR",
      });
      channels.push({
        sampler: samplers.length - 1,
        target: { node: b, path: "rotation" },
      });
    }
    if (model.meshes.some((m) => m.handClosure)) {
      const values = Float32Array.from(
        times,
        (t) => sampleCharacterPose(model, clip.id, t).handClosure ?? 0,
      );
      samplers.push({
        input: time,
        output: attr(values, "SCALAR", 1),
        interpolation: "LINEAR",
      });
      channels.push({
        sampler: samplers.length - 1,
        target: { node: model.bones.length, path: "weights" },
      });
    }
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++)
      positions.set(
        sampleCharacterPose(model, clip.id, times[i]).rootOffset,
        i * 3,
      );
    samplers.push({
      input: time,
      output: attr(positions, "VEC3", 3),
      interpolation: "LINEAR",
    });
    channels.push({
      sampler: samplers.length - 1,
      target: { node: 0, path: "translation" },
    });
    return {
      name: clip.id,
      samplers,
      channels,
      extras: {
        loop: clip.loop,
        rootMotion: clip.rootMotion,
        contacts: clip.contacts,
      },
    };
  });
  nodes.push({ name: `${model.id}-skinned-surfaces`, mesh: 0, skin: 0 });
  const gltf = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0, nodes.length - 1] }],
    nodes,
    meshes: [
      {
        name: model.name,
        primitives,
        ...(model.meshes.some((m) => m.handClosure)
          ? { weights: [0], extras: { targetNames: ["hand-closure"] } }
          : {}),
      },
    ],
    materials,
    skins: [
      {
        name: model.skeletonId,
        inverseBindMatrices,
        joints: model.bones.map((_, i) => i),
        skeleton: 0,
      },
    ],
    animations,
    images: [{ bufferView: imageView, mimeType: "image/jpeg" }],
    samplers: [
      { magFilter: 9729, minFilter: 9729, wrapS: 33071, wrapT: 33071 },
    ],
    textures: [{ source: 0, sampler: 0 }],
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
    extras: {
      playerId: model.id,
      status: model.status,
      source: model.source,
      units: "metres",
      up: "Y",
      forward: "+Z",
      origin: "standing feet midpoint on floor",
      sourceTexturePath: model.materials.find((m) => m.texture)?.texture,
    },
  };
  const json = new TextEncoder().encode(JSON.stringify(gltf)),
    jsonLength = Math.ceil(json.length / 4) * 4,
    binLength = Math.ceil(offset / 4) * 4,
    total = 12 + 8 + jsonLength + 8 + binLength;
  const out = new Uint8Array(total),
    header = new DataView(out.buffer);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, total, true);
  header.setUint32(12, jsonLength, true);
  header.setUint32(16, 0x4e4f534a, true);
  out.fill(32, 20, 20 + jsonLength);
  out.set(json, 20);
  const bin = 20 + jsonLength;
  header.setUint32(bin, binLength, true);
  header.setUint32(bin + 4, 0x004e4942, true);
  let at = bin + 8;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/** Keep the Euler/quaternion convention tied to the source rotation algebra. */
function quaternionAsMatrix(q: readonly number[]): Float32Array {
  const [x, y, z, w] = q;
  return new Float32Array([
    1 - 2 * y * y - 2 * z * z,
    2 * x * y + 2 * z * w,
    2 * x * z - 2 * y * w,
    0,
    2 * x * y - 2 * z * w,
    1 - 2 * x * x - 2 * z * z,
    2 * y * z + 2 * x * w,
    0,
    2 * x * z + 2 * y * w,
    2 * y * z - 2 * x * w,
    1 - 2 * x * x - 2 * y * y,
    0,
    0,
    0,
    0,
    1,
  ]);
}
export const quaternionConventionCheck = (v: V3) => ({
  source: rotation(v),
  glb: quaternionAsMatrix(quaternion(v)),
});
