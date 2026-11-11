/** Bounded reader for this project's exported GLB subset; offline review only. */
import {
  CHARACTER_PROFILES,
  type CharacterPlayerId,
  isCharacterPlayerId,
} from "@/domain/game/characters";
import { MODEL_PROFILES } from "./profiles";
import type {
  Bone,
  BoneName,
  CharacterClipId,
  CharacterModel,
  CharacterPose,
  SkinMesh,
  V3,
} from "./types";
import { CLIP_IDS } from "./types";

type Row = Record<string, unknown>;
const fail = (): never => {
  throw new TypeError("Unsupported character GLB");
};
const row = (v: unknown): Row =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Row)
    : fail();
const list = (v: unknown, limit: number): unknown[] =>
  Array.isArray(v) && v.length > 0 && v.length <= limit ? v : fail();
const integer = (v: unknown, max: number): number =>
  Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max
    ? (v as number)
    : fail();
const scalar = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fail();
const vector = (v: unknown, count: number): number[] =>
  Array.isArray(v) && v.length === count ? v.map(scalar) : fail();
const name = (v: unknown): string =>
  typeof v === "string" && v.length > 0 && v.length <= 120 ? v : fail();

function checkJpegDimensions(bytes: Uint8Array) {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 255) return fail();
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) return fail();
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) return fail();
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      if (
        length < 8 ||
        bytes[offset + 2] !== 8 ||
        width < 1 ||
        height < 1 ||
        width > 2048 ||
        height > 2048
      )
        return fail();
      return;
    }
    offset += length;
  }
  return fail();
}

export interface ImportedCharacter {
  readonly model: CharacterModel;
  readonly texture: Uint8Array;
  readonly clips: readonly CharacterClipId[];
  sample(
    clip: CharacterClipId,
    seconds: number,
    reducedMotion?: boolean,
  ): CharacterPose;
}

function blend(
  a: number[],
  b: number[],
  t: number,
  quaternion: boolean,
): number[] {
  if (!quaternion) return a.map((v, i) => v + (b[i] - v) * t);
  let dot = a.reduce((s, v, i) => s + v * b[i], 0);
  if (dot < 0) {
    b = b.map((v) => -v);
    dot = -dot;
  }
  dot = Math.max(0, Math.min(1, dot));
  const angle = Math.acos(dot),
    denominator = Math.sin(angle);
  const q =
    1 - dot < 1e-6
      ? a.map((v, i) => v + (b[i] - v) * t)
      : a.map(
          (v, i) =>
            (v * Math.sin((1 - t) * angle) + b[i] * Math.sin(t * angle)) /
            denominator,
        );
  const length = Math.hypot(...q);
  if (length < 1e-10) return fail();
  return q.map((v) => v / length);
}

/** Match the native column-vector X→Y→Z Euler convention after GLB SLERP. */
function euler([x, y, z, w]: number[]): V3 {
  const m2 = 2 * (x * z - y * w),
    m6 = 2 * (y * z + x * w),
    m10 = 1 - 2 * (x * x + y * y),
    m1 = 2 * (x * y + z * w),
    m0 = 1 - 2 * (y * y + z * z),
    m9 = 2 * (y * z - x * w),
    m5 = 1 - 2 * (x * x + z * z);
  return [
    Math.abs(m2) < 0.9999999 ? Math.atan2(m6, m10) : Math.atan2(-m9, m5),
    Math.asin(Math.max(-1, Math.min(1, -m2))),
    Math.abs(m2) < 0.9999999 ? Math.atan2(m1, m0) : 0,
  ];
}

export function readCharacterGlb(
  input: Uint8Array,
  expectedId: CharacterPlayerId,
): ImportedCharacter {
  if (
    !isCharacterPlayerId(expectedId) ||
    input.byteLength < 28 ||
    input.byteLength > 32 * 1024 * 1024
  )
    return fail();
  // Own bytes so edits to the caller's buffer cannot change validated animation data.
  const bytes = Uint8Array.from(input),
    data = new DataView(bytes.buffer);
  if (
    data.getUint32(0, true) !== 0x46546c67 ||
    data.getUint32(4, true) !== 2 ||
    data.getUint32(8, true) !== bytes.length ||
    data.getUint32(16, true) !== 0x4e4f534a
  )
    return fail();
  const jsonLength = integer(data.getUint32(12, true), 2 * 1024 * 1024),
    bin = 28 + jsonLength;
  if (
    jsonLength % 4 ||
    bin > bytes.length ||
    data.getUint32(bin - 4, true) !== 0x004e4942 ||
    data.getUint32(bin - 8, true) !== bytes.length - bin
  )
    return fail();
  let json: Row;
  try {
    json = row(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          bytes.subarray(20, 20 + jsonLength),
        ),
      ),
    );
  } catch {
    return fail();
  }
  if (
    row(json.asset).version !== "2.0" ||
    json.extensionsRequired !== undefined
  )
    return fail();
  const extras = row(json.extras),
    source = row(extras.source);
  if (
    extras.playerId !== expectedId ||
    extras.units !== "metres" ||
    extras.up !== "Y" ||
    extras.forward !== "+Z" ||
    extras.status !== "unapproved-candidate" ||
    typeof source.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(source.sha256)
  )
    return fail();
  const sourcePath = name(source.path),
    texturePath = `src/components/game/characters3d/textures/${expectedId}-reference.jpg`;
  if (
    !/^documents\/assets\/characters\/originals\/[a-z0-9-]+\.png$/.test(
      sourcePath,
    ) ||
    extras.sourceTexturePath !== texturePath
  )
    return fail();
  if (
    sourcePath !==
      `documents/assets/characters/originals/${MODEL_PROFILES[expectedId].source}` ||
    source.sha256 !== MODEL_PROFILES[expectedId].sha256
  )
    return fail();
  const views = list(json.bufferViews, 1024).map(row),
    specs = list(json.accessors, 1024).map(row);
  const buffers = list(json.buffers, 1).map(row);
  if (
    buffers[0].uri !== undefined ||
    integer(buffers[0].byteLength, bytes.length - bin) > bytes.length - bin
  )
    return fail();
  const shapes: Record<string, number> = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
    MAT4: 16,
  };
  let decodedComponents = 0;
  const cache = new Map<number, Float32Array | Uint16Array>();
  function accessor(index: unknown, shape: string, component = 5126) {
    const i = integer(index, specs.length - 1),
      spec = specs[i];
    if (
      spec.type !== shape ||
      spec.componentType !== component ||
      spec.normalized ||
      spec.sparse !== undefined
    )
      return fail();
    if (cache.has(i)) return cache.get(i)!;
    const count = integer(spec.count, 200000) * shapes[shape];
    decodedComponents += count;
    if (!count || decodedComponents > 4000000) return fail();
    const result =
      component === 5126 ? new Float32Array(count) : new Uint16Array(count);
    if (spec.bufferView === undefined) {
      cache.set(i, result);
      return result;
    }
    const view = views[integer(spec.bufferView, views.length - 1)],
      width = component === 5126 ? 4 : 2;
    if (view.buffer !== 0 || view.byteStride !== undefined) return fail();
    const viewStart = integer(view.byteOffset ?? 0, bytes.length - bin),
      length = integer(view.byteLength, bytes.length - bin);
    const start = integer(spec.byteOffset ?? 0, length);
    if (
      start % width ||
      viewStart % width ||
      start + count * width > length ||
      viewStart + length > bytes.length - bin
    )
      return fail();
    for (let j = 0; j < count; j++) {
      const offset = bin + viewStart + start + j * width;
      result[j] =
        component === 5126
          ? data.getFloat32(offset, true)
          : data.getUint16(offset, true);
      if (!Number.isFinite(result[j])) return fail();
    }
    cache.set(i, result);
    return result;
  }
  const nodes = list(json.nodes, 64).map(row),
    skins = list(json.skins, 1).map(row),
    skin = skins[0];
  const joints = list(skin.joints, 32).map((v) => integer(v, nodes.length - 1));
  if (
    new Set(joints).size !== joints.length ||
    joints.length !== nodes.length - 1 ||
    skin.skeleton !== joints[0] ||
    joints.length !== 19 ||
    skin.name !== "fourbros-seated-v1"
  )
    return fail();
  const meshNode = nodes.findIndex((n) => n.mesh !== undefined);
  if (
    meshNode < 0 ||
    nodes[meshNode].mesh !== 0 ||
    nodes[meshNode].skin !== 0 ||
    nodes[meshNode].translation !== undefined ||
    nodes[meshNode].rotation !== undefined ||
    nodes[meshNode].scale !== undefined
  )
    return fail();
  const parent = nodes.map(() => -1);
  for (const [i, node] of nodes.entries()) {
    if (
      node.matrix !== undefined ||
      node.scale !== undefined ||
      node.rotation !== undefined
    )
      return fail();
    for (const item of node.children === undefined
      ? []
      : list(node.children, 32)) {
      const child = integer(item, nodes.length - 1);
      if (child <= i || parent[child] !== -1) return fail();
      parent[child] = i;
    }
  }
  const inverse = accessor(skin.inverseBindMatrices, "MAT4");
  if (inverse.length !== joints.length * 16) return fail();
  const bones: Bone[] = [];
  for (const [i, nodeId] of joints.entries()) {
    const node = nodes[nodeId],
      p = parent[nodeId] < 0 ? -1 : joints.indexOf(parent[nodeId]);
    if (p >= i || (i > 0 && p < 0) || (i === 0 && parent[nodeId] !== -1))
      return fail();
    const local = vector(node.translation ?? [0, 0, 0], 3);
    bones.push({
      name: name(node.name) as BoneName,
      parent: p,
      pivot: local.map(
        (v, k) => v + (p < 0 ? 0 : bones[p].pivot[k]),
      ) as unknown as V3,
      inverseBind: Float32Array.from(inverse.subarray(i * 16, (i + 1) * 16)),
    });
  }
  if (new Set(bones.map((b) => b.name)).size !== bones.length) return fail();
  const boneNames: readonly string[] = [
    "root",
    "hips",
    "spine",
    "chest",
    "neck",
    "head",
    "jaw",
    "upperArm.L",
    "forearm.L",
    "hand.L",
    "upperArm.R",
    "forearm.R",
    "hand.R",
    "thigh.L",
    "shin.L",
    "foot.L",
    "thigh.R",
    "shin.R",
    "foot.R",
  ];
  if (
    bones.some(
      (b) =>
        !boneNames.includes(b.name) || b.pivot.some((n) => Math.abs(n) > 5),
    ) ||
    bones[0].name !== "root"
  )
    return fail();
  const mats = list(json.materials, 32)
    .map(row)
    .map((mat) => {
      const pbr = row(mat.pbrMetallicRoughness),
        color = vector(pbr.baseColorFactor, 4);
      const roughness = scalar(pbr.roughnessFactor),
        metallic = scalar(pbr.metallicFactor);
      if (
        color.some((n) => n < 0 || n > 1) ||
        color[3] !== 1 ||
        roughness < 0 ||
        roughness > 1 ||
        metallic < 0 ||
        metallic > 1
      )
        return fail();
      if (
        pbr.baseColorTexture !== undefined &&
        row(pbr.baseColorTexture).index !== 0
      )
        return fail();
      return {
        id: name(mat.name),
        color: color.slice(0, 3) as unknown as V3,
        roughness,
        metallic,
        ...(pbr.baseColorTexture === undefined
          ? {}
          : { texture: texturePath, textureOrigin: "top-left" as const }),
      };
    });
  const mesh = row(list(json.meshes, 1)[0]);
  const meshes: SkinMesh[] = list(mesh.primitives, 32)
    .map(row)
    .map((p, i) => {
      if (p.indices !== undefined || p.mode !== 4) return fail();
      const a = row(p.attributes),
        positions = accessor(a.POSITION, "VEC3"),
        normals = accessor(a.NORMAL, "VEC3"),
        uv = accessor(a.TEXCOORD_0, "VEC2"),
        weights = accessor(a.WEIGHTS_0, "VEC4"),
        joint = accessor(a.JOINTS_0, "VEC4", 5123);
      const vertices = new Float32Array((positions.length / 3) * 8),
        count = positions.length / 3;
      if (
        count % 3 ||
        normals.length !== count * 3 ||
        uv.length !== count * 2 ||
        weights.length !== count * 4 ||
        joint.length !== count * 4
      )
        return fail();
      for (let v = 0; v < count; v++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          if (weights[v * 4 + k] < 0 || joint[v * 4 + k] >= joints.length)
            return fail();
          sum += weights[v * 4 + k];
        }
        if (Math.abs(sum - 1) > 1e-4) return fail();
        vertices.set(positions.subarray(v * 3, v * 3 + 3), v * 8);
        vertices.set(normals.subarray(v * 3, v * 3 + 3), v * 8 + 3);
        vertices.set(uv.subarray(v * 2, v * 2 + 2), v * 8 + 6);
      }
      const colors =
        a.COLOR_0 === undefined ? undefined : accessor(a.COLOR_0, "VEC3");
      if (
        colors &&
        (colors.length !== count * 3 || colors.some((n) => n < 0 || n > 1))
      )
        return fail();
      const target =
        p.targets === undefined ? undefined : row(list(p.targets, 1)[0]);
      const morph = target
        ? {
            positions: Float32Array.from(accessor(target.POSITION, "VEC3")),
            normals: Float32Array.from(accessor(target.NORMAL, "VEC3")),
          }
        : undefined;
      if (
        morph &&
        (morph.positions.length !== count * 3 ||
          morph.normals.length !== count * 3)
      )
        return fail();
      return {
        id: `imported-${i}`,
        materialId: mats[integer(p.material, mats.length - 1)].id,
        vertices,
        joints: Uint16Array.from(joint),
        weights: Float32Array.from(weights),
        ...(colors ? { colors: Float32Array.from(colors) } : {}),
        ...(morph ? { handClosure: morph } : {}),
      };
    });
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes)
    for (let i = 0; i < m.vertices.length; i += 8)
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], m.vertices[i + k]);
        max[k] = Math.max(max[k], m.vertices[i + k]);
      }
  if (max[1] - min[1] < 0.1 || max[1] - min[1] > 5) return fail();
  if ([...min, ...max].some((n) => Math.abs(n) > 5)) return fail();
  const textureBinding = row(list(json.textures, 1)[0]);
  const samplerBinding = row(list(json.samplers, 1)[0]);
  if (
    textureBinding.source !== 0 ||
    textureBinding.sampler !== 0 ||
    samplerBinding.magFilter !== 9729 ||
    samplerBinding.minFilter !== 9729 ||
    samplerBinding.wrapS !== 33071 ||
    samplerBinding.wrapT !== 33071
  )
    return fail();
  const image = row(list(json.images, 1)[0]);
  if (image.mimeType !== "image/jpeg" || image.uri !== undefined) return fail();
  const imageView = views[integer(image.bufferView, views.length - 1)];
  const imageStart = integer(imageView.byteOffset ?? 0, bytes.length - bin),
    imageSize = integer(imageView.byteLength, 8 * 1024 * 1024);
  if (
    imageView.buffer !== 0 ||
    imageSize < 4 ||
    imageStart + imageSize > bytes.length - bin
  )
    return fail();
  const texture = bytes.slice(bin + imageStart, bin + imageStart + imageSize);
  if (
    texture[0] !== 255 ||
    texture[1] !== 216 ||
    texture.at(-2) !== 255 ||
    texture.at(-1) !== 217
  )
    return fail();
  checkJpegDimensions(texture);
  const animationRows = list(json.animations, CLIP_IDS.length).map(row);
  if (
    animationRows.length !== CLIP_IDS.length ||
    new Set(animationRows.map((a) => a.name)).size !== CLIP_IDS.length
  )
    return fail();
  const animations = animationRows.map(row).map((clip) => {
    const id = name(clip.name) as CharacterClipId;
    if (!(CLIP_IDS as readonly string[]).includes(id)) return fail();
    const samplers = list(clip.samplers, 64).map(row),
      channels = list(clip.channels, 64)
        .map(row)
        .map((channel) => {
          const target = row(channel.target),
            node = integer(target.node, nodes.length - 1),
            path = target.path;
          if (
            (path !== "rotation" &&
              path !== "translation" &&
              path !== "weights") ||
            (path === "translation" && node !== joints[0]) ||
            (path === "weights" && node !== meshNode) ||
            (path === "rotation" && !joints.includes(node))
          )
            return fail();
          const sampler =
            samplers[integer(channel.sampler, samplers.length - 1)];
          if ((sampler.interpolation ?? "LINEAR") !== "LINEAR") return fail();
          const times = accessor(sampler.input, "SCALAR") as Float32Array,
            width = path === "rotation" ? 4 : path === "translation" ? 3 : 1,
            values = accessor(
              sampler.output,
              width === 4 ? "VEC4" : width === 3 ? "VEC3" : "SCALAR",
            ) as Float32Array;
          if (
            times.length < 2 ||
            times.length > 1000 ||
            times[0] !== 0 ||
            times.at(-1)! > 60 ||
            values.length !== times.length * width
          )
            return fail();
          for (let i = 1; i < times.length; i++)
            if (times[i] <= times[i - 1]) return fail();
          if (path === "rotation")
            for (let i = 0; i < values.length; i += 4)
              if (Math.abs(Math.hypot(...values.subarray(i, i + 4)) - 1) > 1e-4)
                return fail();
          if (
            path === "weights" &&
            (meshes.every((m) => !m.handClosure) ||
              values.some((n) => n < 0 || n > 1))
          )
            return fail();
          if (path === "translation" && values.some((n) => Math.abs(n) > 5))
            return fail();
          return { node, path, times, values, width };
        });
    if (
      new Set(channels.map((c) => `${c.node}/${c.path}`)).size !==
        channels.length ||
      channels.filter((c) => c.path === "rotation").length !== joints.length ||
      channels.filter((c) => c.path === "translation").length !== 1
    )
      return fail();
    if (
      typeof row(clip.extras).loop !== "boolean" ||
      channels.some((c) => c.times.at(-1) !== channels[0].times.at(-1))
    )
      return fail();
    return {
      id,
      loop: row(clip.extras).loop === true,
      channels,
      duration: Math.max(...channels.map((c) => c.times.at(-1)!)),
    };
  });
  if (
    animations.length !== CLIP_IDS.length ||
    new Set(animations.map((a) => a.id)).size !== CLIP_IDS.length
  )
    return fail();
  const model: CharacterModel = {
    id: expectedId,
    name: CHARACTER_PROFILES[expectedId].defaultName,
    status: "unapproved-candidate",
    skeletonId: "fourbros-seated-v1",
    source: { path: sourcePath, sha256: source.sha256 },
    height: max[1] - min[1],
    bones,
    meshes,
    materials: mats,
    sockets: {},
    bounds: { min: min as unknown as V3, max: max as unknown as V3 },
  };
  function sample(
    clipId: CharacterClipId,
    seconds: number,
    reducedMotion = false,
  ): CharacterPose {
    if (!Number.isFinite(seconds) || seconds < 0)
      throw new TypeError("Character time must be finite and non-negative");
    const requested = animations.find((a) => a.id === clipId);
    if (!requested) throw new TypeError("Unknown character clip");
    const animation =
      reducedMotion && clipId !== "standing-reference"
        ? animations.find((a) => a.id === "seated-idle")!
        : requested;
    const t = reducedMotion
      ? 0
      : animation.loop
        ? seconds % animation.duration
        : Math.min(seconds, animation.duration);
    const rotations: Partial<Record<BoneName, V3>> = {};
    let rootOffset: V3 = [0, 0, 0],
      handClosure = 0;
    for (const c of animation.channels) {
      let lo = 0;
      while (lo + 1 < c.times.length && c.times[lo + 1] <= t) lo++;
      const hi = Math.min(lo + 1, c.times.length - 1),
        alpha = hi === lo ? 0 : (t - c.times[lo]) / (c.times[hi] - c.times[lo]);
      const v = blend(
        Array.from(c.values.subarray(lo * c.width, (lo + 1) * c.width)),
        Array.from(c.values.subarray(hi * c.width, (hi + 1) * c.width)),
        alpha,
        c.path === "rotation",
      );
      if (c.path === "rotation")
        rotations[name(nodes[c.node].name) as BoneName] = euler(v);
      else if (c.path === "translation") rootOffset = v as unknown as V3;
      else handClosure = v[0];
    }
    return {
      rotations,
      rootOffset,
      handClosure,
      clipId,
      finished: !requested.loop && seconds >= requested.duration,
    };
  }
  return { model, texture, clips: animations.map((a) => a.id), sample };
}
