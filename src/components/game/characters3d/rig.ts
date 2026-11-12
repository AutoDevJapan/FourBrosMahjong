import { multiply, point, rotation, sub, translation } from "./matrix";
import type { ModelProfile } from "./profiles";
import type {
  Bone,
  BoneName,
  CharacterModel,
  CharacterPose,
  M4,
  V3,
} from "./types";

export function createRig(p: ModelProfile): readonly Bone[] {
  const s = p.height / 1.75,
    hips = 0.88 * s,
    shoulder = 1.39 * s;
  const defs: readonly [BoneName, number, V3][] = [
    ["root", -1, [0, 0, 0]],
    ["hips", 0, [0, hips, 0]],
    ["spine", 1, [0, 1.04 * s, 0]],
    ["chest", 2, [0, 1.24 * s, 0]],
    ["neck", 3, [0, 1.445 * s, 0]],
    ["head", 4, [0, 1.49 * s, 0]],
    ["jaw", 5, [0, 1.52 * s, 0.055]],
    ["upperArm.L", 3, [p.shoulders, shoulder, 0]],
    ["forearm.L", 7, [p.shoulders + 0.055, 1.14 * s, 0.012]],
    ["hand.L", 8, [p.shoulders + 0.068, 0.945 * s, 0.022]],
    ["upperArm.R", 3, [-p.shoulders, shoulder, 0]],
    ["forearm.R", 10, [-p.shoulders - 0.055, 1.14 * s, 0.012]],
    ["hand.R", 11, [-p.shoulders - 0.068, 0.945 * s, 0.022]],
    ["thigh.L", 1, [0.098 * s, hips, 0]],
    ["shin.L", 13, [0.103 * s, 0.49 * s, 0]],
    ["foot.L", 14, [0.103 * s, 0.105 * s, 0]],
    ["thigh.R", 1, [-0.098 * s, hips, 0]],
    ["shin.R", 16, [-0.103 * s, 0.49 * s, 0]],
    ["foot.R", 17, [-0.103 * s, 0.105 * s, 0]],
  ];
  return defs.map(([name, parent, pivot]) => ({
    name,
    parent,
    pivot,
    inverseBind: translation([-pivot[0], -pivot[1], -pivot[2]]),
  }));
}
export function skinMatrices(
  model: CharacterModel,
  pose: CharacterPose,
): readonly M4[] {
  const world: M4[] = [];
  for (const bone of model.bones) {
    const local = multiply(
      translation(
        bone.parent < 0
          ? pose.rootOffset
          : sub(bone.pivot, model.bones[bone.parent].pivot),
      ),
      rotation(pose.rotations[bone.name] ?? [0, 0, 0]),
    );
    world.push(bone.parent < 0 ? local : multiply(world[bone.parent], local));
  }
  return world.map((m, i) => multiply(m, model.bones[i].inverseBind));
}
export function socketPosition(
  model: CharacterModel,
  pose: CharacterPose,
  name: string,
): V3 {
  const socket = model.sockets[name];
  if (!socket) throw new TypeError(`Unknown character socket: ${name}`);
  const index = model.bones.findIndex((b) => b.name === socket.bone);
  const b = model.bones[index];
  return point(skinMatrices(model, pose)[index], [
    b.pivot[0] + socket.offset[0],
    b.pivot[1] + socket.offset[1],
    b.pivot[2] + socket.offset[2],
  ]);
}
