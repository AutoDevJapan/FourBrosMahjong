import type {
  BoneName,
  CharacterClip,
  CharacterClipId,
  CharacterModel,
  CharacterPose,
  V3,
} from "./types";

const clip = (
  id: CharacterClipId,
  duration: number,
  loop = false,
  contact?: number,
  role = "gesture",
): CharacterClip => ({
  id,
  duration,
  loop,
  rootMotion: "in-place",
  contacts:
    contact === undefined
      ? []
      : [{ time: contact, socket: "right-hand", role }],
});
export const CHARACTER_CLIPS: Readonly<Record<CharacterClipId, CharacterClip>> =
  {
    "standing-reference": clip("standing-reference", 1, true),
    "seated-idle": clip("seated-idle", 4.8, true),
    "bench-idle": clip("bench-idle", 6.4, true),
    deal: clip("deal", 1.2, false, 0.45, "receive"),
    draw: clip("draw", 0.9, false, 0.39, "draw"),
    discard: clip("discard", 0.85, false, 0.34, "release"),
    declare: clip("declare", 1.35, false, 0.43, "declare"),
    call: clip("call", 1.15, false, 0.4, "call"),
    kita: clip("kita", 1.25, false, 0.48, "north-reveal"),
    "win-tsumo": clip("win-tsumo", 2.1, false, 0.72, "celebrate"),
    "win-ron": clip("win-ron", 1.8, false, 0.55, "celebrate"),
    "draw-round": clip("draw-round", 1.8, false, 0.7, "react"),
    "round-end": clip("round-end", 1.35),
  };
const smooth = (t: number) => t * t * (3 - 2 * t);
/** Finite compact gesture, explicitly zero at both ends. */
const pulse = (phase: number, attack = 0.3, hold = 0.55) =>
  phase < attack
    ? smooth(phase / attack)
    : phase < hold
      ? 1
      : 1 - smooth((phase - hold) / (1 - hold));

export function sampleCharacterPose(
  model: CharacterModel,
  id: CharacterClipId,
  seconds: number,
  reducedMotion = false,
): CharacterPose {
  if (!Number.isFinite(seconds) || seconds < 0)
    throw new TypeError("Character time must be finite and non-negative");
  const spec = CHARACTER_CLIPS[id];
  if (!spec) throw new TypeError("Unknown character clip");
  const rotations: Partial<Record<BoneName, V3>> = {};
  if (id === "standing-reference")
    return { rotations, rootOffset: [0, 0, 0], clipId: id, finished: false };
  const s = model.height / 1.75,
    bench = id === "bench-idle";
  const finished = !spec.loop && seconds >= spec.duration;
  const phase = spec.loop
    ? (seconds % spec.duration) / spec.duration
    : Math.min(1, seconds / spec.duration);
  // Pelvis height .49m; feet planted, thighs forward, shins vertical.
  rotations["thigh.L"] = [-Math.PI / 2, 0, -0.035];
  rotations["thigh.R"] = [-Math.PI / 2, 0, 0.035];
  rotations["shin.L"] = [Math.PI / 2, 0, 0];
  rotations["shin.R"] = [Math.PI / 2, 0, 0];
  for (const side of ["L", "R"] as const) {
    rotations[`upperArm.${side}`] = [
      bench ? -0.36 : -1.06,
      0,
      side === "L" ? -0.035 : 0.035,
    ];
    rotations[`forearm.${side}`] = [bench ? -1.05 : -0.5, 0, 0];
  }
  // Breathing returns to exactly the same pose at a loop boundary. One-shot
  // start/end are the fixed seated pose, not a frame-dependent moving target.
  const breath =
    spec.loop && !reducedMotion ? Math.sin(phase * 2 * Math.PI) : 0;
  const amplitude =
    model.id === "p3" ? 0.008 : model.id === "p2" ? 0.006 : 0.004;
  rotations.spine = [breath * amplitude, 0, 0];
  rotations.head = [
    breath * 0.003,
    bench ? -breath * 0.025 : breath * 0.008,
    0,
  ];
  if (!spec.loop && !finished && !reducedMotion) {
    const a = pulse(phase),
      v = model.id === "p2" ? 1.18 : model.id === "p0" ? 0.83 : 1;
    const set = (bone: BoneName, x: number, y = 0, z = 0) => {
      const base = rotations[bone] ?? [0, 0, 0];
      rotations[bone] = [
        base[0] + x * a * v,
        base[1] + y * a * v,
        base[2] + z * a * v,
      ];
    };
    switch (id) {
      case "deal":
        set("head", 0.1);
        set("forearm.R", -0.12);
        break;
      case "draw":
        set("upperArm.R", -0.17, 0.1);
        set("forearm.R", 0.18);
        break;
      case "discard":
        set("upperArm.R", -0.25, -0.16);
        set("forearm.R", 0.21);
        set("hand.R", 0.14);
        break;
      case "declare":
        set("upperArm.R", -0.23, -0.16, -0.14);
        set("forearm.R", -0.44);
        set("head", -0.06);
        set("jaw", 0.07);
        break;
      case "call":
        set("upperArm.R", -0.12, 0.19, -0.19);
        set("forearm.R", -0.33);
        set("hand.R", -0.16, 0, 0.2);
        set("head", -0.04, 0.09);
        set("jaw", 0.09);
        break;
      case "kita":
        set("upperArm.R", -0.1, -0.1);
        set("forearm.R", -0.57);
        set("hand.R", -0.27);
        set("head", 0.04, -0.08);
        break;
      case "win-tsumo":
      case "win-ron": {
        const intensity = id === "win-tsumo" ? 1 : 0.76;
        set("chest", -0.035 * intensity);
        set("head", -0.09 * intensity);
        set("jaw", 0.1);
        set("upperArm.R", -0.1, 0, -0.26 * intensity);
        set("forearm.R", -0.8 * intensity);
        set("hand.R", -0.25);
        if (model.id === "p2") {
          set("upperArm.L", -0.12, 0, 0.24);
          set("forearm.L", -0.82);
        }
        if (model.id === "p3") {
          set("upperArm.L", -0.03, 0, 0.23);
          set("forearm.L", -0.52);
          set("hand.L", 0, 0, -0.55);
          set("hand.R", 0, 0, 0.55);
        }
        if (model.id === "p1") set("head", 0, -0.12, -0.04);
        break;
      }
      case "draw-round":
        set("head", 0.16);
        set("forearm.R", 0.1);
        break;
      case "round-end":
        set("head", 0.13);
        set("chest", 0.045);
        break;
    }
  }
  return { rotations, rootOffset: [0, -0.39 * s, 0], clipId: id, finished };
}
