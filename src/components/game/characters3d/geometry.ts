import { add, cross, scale, sub, unit } from "./matrix";
import { headTextureRegions, type ModelProfile } from "./profiles";
import type { Bone, BoneName, SkinMesh, V3 } from "./types";

type Influence = readonly (readonly [number, number])[];
type Weight = (v: V3) => Influence;
type Surface = (u: number, v: number) => V3;
type UvProjector = (p: V3, view: View, center: V3) => readonly [number, number];
type View = "front" | "right" | "back" | "left";

/** Fixed source projection in rest space. Never re-project UV after posing. */
export function sourceUv(
  p: ModelProfile,
  v: V3,
  view: View,
): readonly [number, number] {
  const ppm = (p.photo.floor - p.photo.top) / p.height;
  // Arm silhouette lies outside the torso projection. Compress that region
  // into the sheet's sleeve extent rather than sampling the neighboring view.
  const s = p.height / 1.75;
  // Keep torso crest coordinates undistorted, compress only the separate arms.
  const lateral =
    Math.abs(v[0]) > p.shoulders * 0.98 && v[1] < 1.48 * s ? 0.78 : 1;
  const x =
    view === "front"
      ? p.photo.front + v[0] * ppm * lateral
      : view === "back"
        ? p.photo.back - v[0] * ppm * lateral
        : view === "right"
          ? p.photo.right - v[2] * ppm
          : p.photo.left + v[2] * ppm;
  return [x / 1536, (p.photo.floor - v[1] * ppm) / 1536];
}

function headUv(
  p: ModelProfile,
  v: V3,
  view: View,
  center: V3 = v,
): readonly [number, number] {
  const chin = p.height - p.headLength - 0.025,
    ppm = (p.photo.floor - p.photo.top) / p.height;
  if (!p.headViews) return sourceUv(p, v, view);
  const q = p.headViews[view],
    front = p.headViews.front,
    frontY = p.photo.floor - v[1] * ppm;
  if (view === "front")
    return [(front.center + v[0] * ppm) / 1536, frontY / 1536];
  const region = headTextureRegions(p).find((r) => r.view === view);
  // The existing p2 scalp patch stays in its original atlas coordinates.
  if (region && center[1] < chin + 0.018) return sourceUv(p, v, view);
  const lower = Math.max(0, Math.min(1, (chin + 0.055 - v[1]) / 0.055));
  const x =
    view === "back"
      ? q.center - (v[0] / p.headWidth) * q.halfWidth
      : q.center +
        lower * 7 +
        (((view === "right" || q.mirror ? -1 : 1) * v[2]) /
          (p.headDepth + 0.025)) *
          q.halfWidth *
          (v[2] > 0 ? 0.85 : 1) *
          (1 - 0.55 * lower);
  const t = Math.max(
      0,
      Math.min(1, (v[1] - chin - 0.018) / (p.height - chin - 0.018)),
    ),
    y = region
      ? q.bottom - t * (q.bottom - q.top)
      : Math.min(
          q.bottom - (view === "back" ? 0 : 5),
          q.top +
            ((frontY - front.top) * (q.bottom - q.top)) /
              (front.bottom - front.top),
        );
  if (!region) return [x / 1536, y / 1536];
  return [
    (region.atlas.left +
      Math.max(
        0.005,
        Math.min(0.995, (x - region.source.left) / region.source.width),
      ) *
        region.atlas.width) /
      1536,
    (region.atlas.top +
      Math.max(
        0.005,
        Math.min(0.995, (y - region.source.top) / region.source.height),
      ) *
        region.atlas.height) /
      1536,
  ];
}

/** Expanded triangles make independent view projection seams explicit. */
class CharacterMeshBuilder {
  private groups = new Map<string, { v: number[]; j: number[]; w: number[] }>();
  constructor(
    private readonly profile: ModelProfile,
    private readonly bones: readonly Bone[],
  ) {}
  rigid(name: BoneName): Weight {
    const i = this.bones.findIndex((b) => b.name === name);
    return () => [[i, 1]];
  }
  blend(a: BoneName, b: BoneName, lo: number, hi: number): Weight {
    const i = this.bones.findIndex((v) => v.name === a),
      j = this.bones.findIndex((v) => v.name === b);
    return (v) => {
      const t = Math.max(0, Math.min(1, (v[1] - lo) / (hi - lo)));
      return [
        [i, 1 - t],
        [j, t],
      ];
    };
  }
  surface(
    id: string,
    material: string,
    fn: Surface,
    us: number,
    vs: number,
    weight: Weight,
    uv = true,
    uvProjector?: UvProjector,
    materialFor?: (p: V3) => string,
  ) {
    const vertex = (u: number, v: number): { p: V3; n: V3 } => {
      const p = fn(u, v),
        du = sub(fn(u + 0.0001, v), fn(u - 0.0001, v)),
        dv = sub(
          fn(u, Math.min(1, v + 0.0001)),
          fn(u, Math.max(0, v - 0.0001)),
        );
      return { p, n: unit(cross(du, dv)) };
    };
    for (let y = 0; y < vs; y++)
      for (let x = 0; x < us; x++) {
        const a = vertex(x / us, y / vs),
          b = vertex((x + 1) / us, y / vs),
          c = vertex((x + 1) / us, (y + 1) / vs),
          d = vertex(x / us, (y + 1) / vs);
        for (const tri of [
          [a, b, c],
          [a, c, d],
        ]) {
          if (
            Math.hypot(
              ...cross(sub(tri[1].p, tri[0].p), sub(tri[2].p, tri[0].p)),
            ) < 1e-10
          )
            continue;
          const center: V3 = [0, 1, 2].map(
            (k) => tri.reduce((sum, v) => sum + v.p[k], 0) / 3,
          ) as unknown as V3;
          const key = materialFor?.(center) ?? material;
          const g = this.groups.get(key) ?? { v: [], j: [], w: [] };
          this.groups.set(key, g);
          // Use the authored circumferential direction, not wrinkle normals:
          // otherwise each little fold would switch between sheet views.
          const a = ((x + 0.5) / us) * Math.PI * 2;
          const n: V3 = [Math.sin(a), 0, Math.cos(a)];
          // Prefer front/back until a surface becomes nearly side-on. A seam is
          // deliberate; interpolating UV across different sheet columns is not.
          const view: View =
            Math.abs(n[0]) > Math.abs(n[2]) * 1.15
              ? n[0] > 0
                ? "right"
                : "left"
              : n[2] >= 0
                ? "front"
                : "back";
          for (const vertex of tri) {
            const tex = uv
              ? (uvProjector ?? ((p, view) => sourceUv(this.profile, p, view)))(
                  vertex.p,
                  view,
                  center,
                )
              : [0, 0];
            g.v.push(...vertex.p, ...vertex.n, ...tex);
            const influences = weight(vertex.p).filter(([, w]) => w > 0);
            for (let k = 0; k < 4; k++) {
              g.j.push(influences[k]?.[0] ?? 0);
              g.w.push(influences[k]?.[1] ?? 0);
            }
          }
        }
      }
    void id;
  }
  ellipsoid(
    id: string,
    center: V3,
    radius: V3,
    material: string,
    weight: Weight,
    segments = 20,
    rings = 12,
    uv = true,
  ) {
    this.surface(
      id,
      material,
      (u, v) => {
        const a = u * Math.PI * 2,
          t = (v - 0.5) * Math.PI;
        return [
          center[0] + radius[0] * Math.sin(a) * Math.cos(t),
          center[1] + radius[1] * Math.sin(t),
          center[2] + radius[2] * Math.cos(a) * Math.cos(t),
        ];
      },
      segments,
      rings,
      weight,
      uv,
    );
  }
  /** Round section along a cubic Bezier, with deterministic taper. */
  tube(
    id: string,
    points: readonly [V3, V3, V3, V3],
    radius: number,
    material: string,
    weight: Weight,
    segments = 8,
    steps = 8,
    taper = 0,
    uv = false,
  ) {
    const curve = (v: number): V3 => {
      const t = Math.max(0, Math.min(1, v)),
        k = 1 - t;
      return [0, 1, 2].map(
        (i) =>
          k * k * k * points[0][i] +
          3 * k * k * t * points[1][i] +
          3 * k * t * t * points[2][i] +
          t * t * t * points[3][i],
      ) as unknown as V3;
    };
    this.surface(
      id,
      material,
      (u, v) => {
        const center = curve(v),
          axis = unit(
            sub(
              curve(Math.min(0.9999, v + 0.0001)),
              curve(Math.max(0.0001, v - 0.0001)),
            ),
          );
        const n = unit(
            cross(axis, Math.abs(axis[1]) > 0.9 ? [0, 0, 1] : [0, 1, 0]),
          ),
          b = cross(axis, n);
        const a = u * 2 * Math.PI,
          r = radius * (1 - taper * v);
        return add(
          center,
          add(scale(n, Math.cos(a) * r), scale(b, Math.sin(a) * r)),
        );
      },
      segments,
      steps,
      weight,
      uv,
    );
  }
  meshes(): readonly SkinMesh[] {
    return [...this.groups].map(([materialId, g]) => ({
      id: `surface-${materialId}`,
      materialId,
      vertices: new Float32Array(g.v),
      joints: new Uint16Array(g.j),
      weights: new Float32Array(g.w),
    }));
  }
}

type Ring = readonly [number, number, number, number?];
/** Elliptical contour sections (y, x radius, z radius, z shift). */
function loft(rings: readonly Ring[], centerX = 0, fold = 0): Surface {
  return (u, v) => {
    const n = Math.min(rings.length - 2, Math.floor(v * (rings.length - 1))),
      t = v * (rings.length - 1) - n;
    const a = rings[n],
      b = rings[n + 1],
      lerp = (i: number) => (a[i] ?? 0) * (1 - t) + (b[i] ?? 0) * t;
    const angle = u * 2 * Math.PI;
    const ripple =
      1 + fold * Math.sin(angle * 9 + v * 39) * Math.sin(Math.PI * v);
    return [
      centerX + Math.sin(angle) * lerp(1) * ripple,
      lerp(0),
      Math.cos(angle) * lerp(2) * ripple + lerp(3),
    ];
  };
}

export function buildCharacterMeshes(
  p: ModelProfile,
  bones: readonly Bone[],
): readonly SkinMesh[] {
  const b = new CharacterMeshBuilder(p, bones),
    s = p.height / 1.75;
  const rigid = (name: BoneName) => b.rigid(name);
  const torso = b.blend("spine", "chest", 1.1 * s, 1.34 * s),
    hip = b.blend("hips", "spine", 0.9 * s, 1.08 * s);
  for (const sign of [-1, 1]) {
    const side = sign > 0 ? "L" : "R",
      legX = 0.103 * s * sign;
    const shoeTop =
      p.shoe === "boot" ? 0.23 : p.shoe === "high-top" ? 0.18 : 0.145;
    b.surface(
      `shoe-${side}`,
      "reference",
      loft(
        [
          [0.018 * s, 0.074 * s, 0.139 * s, 0.035 * s],
          [0.04 * s, 0.078 * s, 0.145 * s, 0.035 * s],
          [0.08 * s, 0.075 * s, 0.137 * s, 0.035 * s],
          [0.115 * s, 0.065 * s, 0.1 * s, 0.025 * s],
          [shoeTop * s, 0.054 * s, 0.061 * s],
        ],
        legX,
      ),
      24,
      8,
      rigid(`foot.${side}`),
    );
    b.surface(
      `sole-${side}`,
      p.shoe === "high-top" ? "sole" : "rib",
      loft(
        [
          [0, 0.074 * s, 0.139 * s, 0.035 * s],
          [0.021 * s, 0.076 * s, 0.141 * s, 0.035 * s],
        ],
        legX,
      ),
      24,
      2,
      rigid(`foot.${side}`),
      false,
    );
    const sx = sign * p.shoulders;
    const wristY = 0.944 * s,
      wristX = sx + sign * 0.068;
    b.surface(
      `cuff-${side}`,
      "rib",
      loft(
        [
          [wristY, 0.046 * s, 0.049 * s, 0.02],
          [0.975 * s, 0.05 * s, 0.054 * s, 0.018],
          [0.975 * s, 0.043 * s, 0.046 * s, 0.018],
          [wristY, 0.04 * s, 0.043 * s, 0.02],
          [wristY, 0.046 * s, 0.049 * s, 0.02],
        ],
        wristX,
      ),
      24,
      4,
      rigid(`forearm.${side}`),
      false,
    );
    // Same boundary ring and forearm weights as the cuff. The skin bridges
    // through the hand pivot before blending to the rotating palm.
    b.surface(
      `wrist-skin-${side}`,
      "skin",
      loft(
        [
          [0.906 * s, 0.032 * s, 0.025 * s, 0.03],
          [0.926 * s, 0.038 * s, 0.038 * s, 0.025],
          [wristY, 0.046 * s, 0.049 * s, 0.02],
        ],
        wristX,
      ),
      24,
      4,
      b.blend(`hand.${side}`, `forearm.${side}`, 0.914 * s, wristY),
      false,
    );
    // The metacarpals end above the finger tips. A shorter, flatter palm
    // leaves the four distal silhouettes visible instead of swallowing them.
    b.ellipsoid(
      `hand-${side}`,
      [wristX, 0.911 * s, 0.028],
      [0.035 * s, 0.043 * s, 0.019 * s],
      "skin",
      rigid(`hand.${side}`),
      16,
      10,
      false,
    );
    // Rounded, slightly cupped digits. Both hands mirror across the body;
    // index/middle/ring/little keep distinct lengths and a common knuckle arc.
    const digit = (
      id: string,
      from: V3,
      to: V3,
      radius: number,
      segments: number,
      curl: number,
    ) => {
      const axis = unit(sub(to, from)),
        across = unit(cross(axis, [0, 0, 1])),
        depth = cross(across, axis);
      b.surface(
        id,
        "skin",
        (u, v) => {
          const angle = u * Math.PI * 2,
            cap = Math.sin(v * Math.PI),
            t = (1 - Math.cos(v * Math.PI)) / 2,
            r = radius * cap * (1 - 0.18 * t),
            center = add(add(from, scale(sub(to, from), t)), [
              0,
              0,
              curl * Math.sin((t * Math.PI) / 2),
            ]);
          return add(
            center,
            add(
              scale(across, Math.cos(angle) * r),
              scale(depth, Math.sin(angle) * r),
            ),
          );
        },
        segments,
        6,
        rigid(`hand.${side}`),
        false,
      );
    };
    const lengths = [0.057, 0.064, 0.06, 0.048];
    for (let f = 0; f < 4; f++) {
      const x = wristX + sign * (f - 1.5) * 0.016 * s,
        y = (0.892 - Math.abs(f - 1) * 0.002) * s;
      digit(
        `finger-${side}-${f}`,
        [x, y, 0.028],
        [x + sign * (f - 1.5) * 0.0015 * s, y - lengths[f] * s, 0.028],
        (f === 3 ? 0.007 : 0.0077) * s,
        8,
        0.01 * s,
      );
    }
    // Oblique opposition from the radial edge, with its root inside the palm.
    digit(
      `thumb-${side}`,
      [wristX - sign * 0.023 * s, 0.925 * s, 0.031],
      [wristX - sign * 0.049 * s, 0.876 * s, 0.037],
      0.012 * s,
      10,
      0.009 * s,
    );
    if (p.shoe === "cargo-shoe") {
      b.ellipsoid(
        `cargo-pocket-${side}`,
        [legX + sign * 0.07, 0.69 * s, 0.036],
        [0.048, 0.083, 0.078],
        "reference",
        rigid(`thigh.${side}`),
        10,
        6,
      );
      b.tube(
        `cargo-flap-${side}`,
        [
          [legX + sign * 0.103, 0.758 * s, 0.085],
          [legX + sign * 0.09, 0.75 * s, 0.104],
          [legX + sign * 0.06, 0.748 * s, 0.112],
          [legX + sign * 0.04, 0.747 * s, 0.109],
        ],
        0.005,
        "rib",
        rigid(`thigh.${side}`),
        6,
        4,
      );
    }
  }
  // Closed shell: outer, top annulus, inner wall and bottom annulus. The
  // inner lip overlaps the neck; an open cylinder reads as a floating ring.
  const collarProfile = loft([
    [1.432 * s, 0.076 * s, 0.067 * s],
    [1.472 * s, 0.069 * s, 0.061 * s],
    [1.472 * s, 0.051 * s, 0.044 * s],
    [1.432 * s, 0.051 * s, 0.044 * s],
    [1.432 * s, 0.076 * s, 0.067 * s],
  ]);
  const collarWeight = b.blend("chest", "neck", 1.425 * s, 1.455 * s);
  b.surface(
    "collar",
    "rib",
    (u, v) => {
      const q = collarProfile(u, v);
      return [
        q[0],
        q[1] - 0.021 * s * Math.max(0, Math.cos(u * 2 * Math.PI)) ** 4,
        q[2],
      ];
    },
    32,
    4,
    collarWeight,
    false,
  );
  for (const y of [1.455, 1.465])
    b.surface(
      "collar-trim",
      "accent",
      (u, v) => {
        const q = loft([
          [y * s, 0.072 * s, 0.063 * s],
          [(y + 0.0015) * s, 0.072 * s, 0.063 * s],
        ])(u, v);
        return [
          q[0],
          q[1] - 0.021 * s * Math.max(0, Math.cos(u * 2 * Math.PI)) ** 4,
          q[2],
        ];
      },
      20,
      1,
      collarWeight,
      false,
    );
  const chin = p.height - p.headLength - 0.025,
    headTop = p.height - 0.028;
  const neckRings: readonly Ring[] = [
    [1.43 * s, 0.06 * s, 0.053 * s],
    [
      1.475 * s,
      Math.max(0.049 * s, p.jawWidth * 0.62),
      Math.max(0.044 * s, p.headDepth * 0.5),
      -0.006 * s,
    ],
    [chin + 0.008, p.jawWidth * 0.68, p.headDepth * 0.55, -0.006],
    [chin + 0.03, p.jawWidth * 0.84, p.headDepth * 0.78, 0.003],
  ];
  const head = loft([
    ...neckRings,
    [chin + 0.046, p.jawWidth * 0.9, p.headDepth * 0.83, 0.003],
    [chin + 0.083, p.headWidth * 0.87, p.headDepth * 0.94],
    [chin + 0.121, p.headWidth, p.headDepth],
    [chin + 0.16, p.headWidth * 0.96, p.headDepth * 0.98],
    [headTop - 0.025, p.headWidth * 0.76, p.headDepth * 0.83],
    [headTop, 0.018, 0.022],
  ]);
  b.surface(
    "sculpted-head",
    "reference",
    (u, v) => {
      const q = head(u, v),
        front = Math.max(0, Math.cos(u * 2 * Math.PI));
      // Individually sized cheeks/chin, brow bridge and an actual nose silhouette.
      const nose =
        0.024 *
        Math.exp(
          -((q[0] / 0.02) ** 2) - ((q[1] - (chin + 0.105)) / 0.031) ** 2,
        );
      const cheeks =
        (p.hairStyle === "fringe"
          ? 0.012
          : p.hairStyle === "crop"
            ? 0.007
            : 0.002) * Math.exp(-(((q[1] - (chin + 0.079)) / 0.043) ** 2));
      const ear =
        0.009 *
        Math.exp(-(((q[1] - (chin + 0.109)) / 0.03) ** 2)) *
        Math.abs(Math.sin(u * 2 * Math.PI)) ** 18;
      return [
        q[0] + Math.sign(q[0]) * ear,
        q[1],
        q[2] + front * front * (nose + cheeks),
      ];
    },
    32,
    22,
    (v) => {
      const headIndex = bones.findIndex((q) => q.name === "head"),
        jawIndex = bones.findIndex((q) => q.name === "jaw");
      if (v[1] < chin + 0.025)
        return b.blend("neck", "head", 1.46 * s, chin + 0.012)(v);
      const jaw =
        v[2] > 0.04
          ? Math.max(0, 0.28 * (1 - Math.abs(v[1] - (chin + 0.05)) / 0.035))
          : 0;
      return [
        [headIndex, 1 - jaw],
        [jawIndex, jaw],
      ];
    },
    true,
    (v, view, center) => headUv(p, v, view, center),
    // Registration stays in rest space and is uniform within each triangle.
  );
  // A shaped cap has a high forehead, clipped/swept sides and a low nape.
  const bottom = (u: number) => {
    const a = u * 2 * Math.PI,
      front = Math.cos(a),
      style = p.hairStyle;
    const f = (front + 1) / 2;
    const frontHeight =
      style === "fringe" ? 0.194 : style === "crop" ? 0.2 : 0.205;
    return (
      chin +
      (style === "swept" ? 0.1 : style === "crop" ? 0.092 : 0.085) +
      (frontHeight -
        (style === "swept" ? 0.1 : style === "crop" ? 0.092 : 0.085)) *
        f *
        f
    );
  };
  b.surface(
    "hair-cap",
    "reference",
    (u, v) => {
      const a = u * 2 * Math.PI,
        low = bottom(u),
        t = (v * Math.PI) / 2;
      const r = Math.cos(t) * (1 + 0.035 * Math.sin(a * 13 + v * 7));
      return [
        Math.sin(a) * (p.headWidth + 0.006) * r,
        low + (p.height - low) * Math.sin(t),
        Math.cos(a) * (p.headDepth + 0.006) * r - 0.004,
      ];
    },
    32,
    12,
    rigid("head"),
    true,
    (v, view, center) => {
      if (p.headViews && (p.hairStyle === "crop" || view !== "front"))
        return headUv(p, v, view, center);
      const back = view === "back",
        textureCenter = back ? p.photo.back : p.photo.front;
      return [
        (textureCenter + (v[0] / p.headWidth) * 26 * (back ? -1 : 1)) / 1536,
        (p.photo.top +
          5 +
          Math.min(0.14, p.height - v[1]) * (back ? 280 : 80)) /
          1536,
      ];
    },
  );
  const locks =
    p.hairStyle === "crop" ? 24 : p.hairStyle === "fringe" ? 22 : 18;
  for (let i = 0; i < locks; i++) {
    const t = i / (locks - 1),
      x = (t - 0.5) * p.headWidth * 1.6;
    const crownDrop = 0.06 * (x / p.headWidth) ** 2;
    let path: readonly [V3, V3, V3, V3];
    if (p.hairStyle === "crop") {
      path = [
        [x, p.height - 0.043 - crownDrop, 0.031],
        [x - 0.005, p.height - 0.019 - crownDrop, 0.034],
        [x - 0.009, p.height - 0.002 - crownDrop, 0.021],
        [x - 0.007, p.height - 0.006 - crownDrop, -0.018],
      ];
    } else if (p.hairStyle === "fringe") {
      path = [
        [x * 0.8, p.height - 0.025 - crownDrop, -0.032],
        [x * 0.91 - 0.012, p.height - 0.012 - crownDrop, 0.024],
        [x - 0.016, chin + 0.208, 0.098],
        [x - 0.008, chin + 0.16 + (i % 4) * 0.006, 0.086],
      ];
    } else {
      const wave = p.hairStyle === "wave" ? 0.017 : 0.004;
      path = [
        [x, chin + 0.177, 0.081],
        [x - 0.017, p.height - 0.01 + wave - crownDrop, 0.072],
        [x - 0.024, p.height - 0.01 + wave - crownDrop, -0.01],
        [x - 0.009, p.height - 0.064, -0.085],
      ];
    }
    b.tube(
      `hair-lock-${i}`,
      path,
      p.hairStyle === "crop" ? 0.004 : 0.005,
      "hair-highlight",
      rigid("head"),
      5,
      5,
      0.94,
    );
  }
  // Zipper and chain are separate relief and stay attached to chest/hips.
  for (const sign of [-1, 1])
    b.tube(
      "front-zip",
      [
        [sign * 0.032, 1.42 * s, p.depth * 0.88],
        [sign * 0.027, 1.27 * s, p.depth * 1.012],
        [sign * 0.022, 1.1 * s, p.depth * 1.11],
        [sign * 0.031, 0.96 * s, p.depth],
      ],
      0.0019,
      "silver",
      (v) => (v[1] < 1.09 * s ? hip(v) : torso(v)),
      6,
      10,
    );
  b.tube(
    "necklace",
    [
      [-0.048, 1.43 * s, 0.073],
      [-0.035, 1.35 * s, p.depth + 0.007],
      [0.012, 1.33 * s, p.depth + 0.013],
      [0.052, 1.43 * s, 0.072],
    ],
    0.0017,
    "silver",
    torso,
    6,
    12,
  );
  b.ellipsoid(
    "pendant",
    [0, 1.349 * s, p.depth + 0.012],
    [0.006, 0.015, 0.003],
    "silver",
    torso,
    8,
    6,
    false,
  );
  b.tube(
    "hip-chain",
    [
      [-p.waist * 0.68, 0.91 * s, p.depth * 0.8],
      [-p.waist * 1.22, 0.73 * s, p.depth],
      [-p.waist * 0.36, 0.7 * s, p.depth * 0.9],
      [-p.waist * 0.02, 0.879 * s, p.depth * 0.9],
    ],
    0.0022,
    "silver",
    rigid("hips"),
    6,
    16,
  );
  return b.meshes();
}
