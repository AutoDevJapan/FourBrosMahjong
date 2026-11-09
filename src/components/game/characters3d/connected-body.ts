import { sourceUv } from "./geometry";
import { cross, dot, sub, unit } from "./matrix";
import type { ModelProfile } from "./profiles";
import type { Bone, BoneName, SkinMesh, V3 } from "./types";

const smoothMin = (a: number, b: number, k = 0.025) => {
  const h = Math.max(0, k - Math.abs(a - b)) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
/** One closed isosurface for torso, shoulders, sleeves, pelvis and both legs.
 * No open cylinders or disconnected shoulder/waist/crotch edges. */
export function connectedClothing(
  p: ModelProfile,
  bones: readonly Bone[],
): SkinMesh {
  const s = p.height / 1.75;
  const capsule = (v: V3, a: V3, b: V3, rx: number, rz: number, r1: number) => {
    const axis = sub(b, a),
      t = Math.max(0, Math.min(1, dot(sub(v, a), axis) / dot(axis, axis))),
      r = rx * (1 - t) + r1 * t;
    const q: V3 = [
      v[0] - a[0] - axis[0] * t,
      v[1] - a[1] - axis[1] * t,
      v[2] - a[2] - axis[2] * t,
    ];
    return (Math.hypot(q[0] / r, q[1] / r, q[2] / rz) - 1) * Math.min(r, rz);
  };
  const sections: readonly V3[] = [
    [0.79 * s, p.waist * 0.9, p.depth * 0.84],
    [0.91 * s, p.waist, p.depth * 0.92],
    [1.04 * s, p.belly, p.depth * 1.07],
    [1.2 * s, p.belly, p.depth],
    [1.34 * s, p.shoulders * 0.91, p.depth * 0.89],
    [1.39 * s, p.shoulders * 0.88, p.depth * 0.8],
    [1.47 * s, 0.066 * s, 0.057 * s],
  ];
  const torso = (v: V3) => {
    let i = 0;
    while (i < sections.length - 2 && v[1] > sections[i + 1][0]) i++;
    const a = sections[i],
      b = sections[i + 1],
      t = Math.max(0, Math.min(1, (v[1] - a[0]) / (b[0] - a[0]))),
      rx = a[1] + (b[1] - a[1]) * t,
      rz = a[2] + (b[2] - a[2]) * t;
    const radial = (Math.hypot(v[0] / rx, v[2] / rz) - 1) * Math.min(rx, rz);
    return Math.max(
      radial,
      sections[0][0] - v[1],
      v[1] - sections[sections.length - 1][0],
    );
  };
  const density = (v: V3) => {
    let d = torso(v);
    for (const sign of [-1, 1]) {
      const arm = capsule(
        [
          v[0] -
            sign *
              0.04 *
              s *
              Math.exp(-(((v[1] - 1.12 * s) / (0.09 * s)) ** 2)),
          v[1],
          v[2],
        ],
        [sign * p.shoulders * 0.92, 1.35 * s, 0],
        [sign * (p.shoulders + 0.068), 0.985 * s, 0.018],
        0.079 * s,
        0.076 * s,
        0.049 * s,
      );
      const leg = capsule(
        v,
        [sign * 0.103 * s, 0.81 * s, 0],
        [sign * 0.103 * s, 0.16 * s, 0],
        (p.waist > 0.18 ? 0.093 : 0.077) * s,
        0.076 * s,
        0.054 * s,
      );
      d = smoothMin(
        smoothMin(d, arm, v[1] > 1.24 * s ? 0.035 : 0.003),
        leg,
        0.02,
      );
    }
    return d;
  };
  const step = 0.061,
    lo: V3 = [-p.shoulders - 0.14, 0.09 * s, -p.depth - 0.05],
    hi: V3 = [p.shoulders + 0.14, 1.51 * s, p.depth + 0.06];
  const xs = Array.from(
    { length: Math.ceil((hi[0] - lo[0]) / step) + 1 },
    (_, i) => lo[0] + i * step,
  );
  xs.push(-p.belly - 0.01, p.belly + 0.01);
  xs.sort((a, b) => a - b);
  const nx = xs.length - 1,
    ny = Math.ceil((hi[1] - lo[1]) / step),
    nz = Math.ceil((hi[2] - lo[2]) / step);
  const grid = new Float32Array((nx + 1) * (ny + 1) * (nz + 1));
  const index = (x: number, y: number, z: number) =>
    (z * (ny + 1) + y) * (nx + 1) + x;
  const pos = (x: number, y: number, z: number): V3 => [
    xs[x],
    lo[1] + y * step,
    lo[2] + z * step,
  ];
  for (let z = 0; z <= nz; z++)
    for (let y = 0; y <= ny; y++)
      for (let x = 0; x <= nx; x++)
        grid[index(x, y, z)] = density(pos(x, y, z));
  const corners: readonly V3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1],
  ];
  const tets = [
    [0, 5, 1, 6],
    [0, 1, 2, 6],
    [0, 2, 3, 6],
    [0, 3, 7, 6],
    [0, 7, 4, 6],
    [0, 4, 5, 6],
  ];
  const edges = [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 2],
    [1, 3],
    [2, 3],
  ];
  const vertices: number[] = [],
    joints: number[] = [],
    weights: number[] = [];
  const bone = (name: BoneName) => bones.findIndex((b) => b.name === name);
  const emit = (a: V3, b: V3, c: V3) => {
    const normal = (p: V3): V3 =>
      unit([
        density([p[0] + 0.001, p[1], p[2]]) -
          density([p[0] - 0.001, p[1], p[2]]),
        density([p[0], p[1] + 0.001, p[2]]) -
          density([p[0], p[1] - 0.001, p[2]]),
        density([p[0], p[1], p[2] + 0.001]) -
          density([p[0], p[1], p[2] - 0.001]),
      ]);
    if (Math.hypot(...cross(sub(b, a), sub(c, a))) < 1e-14) return;
    const tri =
      dot(cross(sub(b, a), sub(c, a)), normal(a)) < 0 ? [a, c, b] : [a, b, c];
    const center: V3 = [
      (a[0] + b[0] + c[0]) / 3,
      (a[1] + b[1] + c[1]) / 3,
      (a[2] + b[2] + c[2]) / 3,
    ];
    const sleeve =
      Math.abs(center[0]) > p.shoulders * 0.88 &&
      center[1] > 0.92 * s &&
      center[1] < 1.4 * s;
    for (const v of tri) {
      if (sleeve) {
        const side = center[0] > 0 ? 1 : -1;
        const around = Math.max(
          0,
          Math.min(1, ((v[0] - side * (p.shoulders + 0.035)) / 0.085 + 1) / 2),
        );
        const u = ((side > 0 ? 0 : 256) + around * 224) / 1536;
        const uv: readonly [number, number] = [
          u,
          (1024 +
            Math.max(0, Math.min(1, (1.42 * s - v[1]) / (0.48 * s))) * 400) /
            1536,
        ];
        vertices.push(...v, ...normal(v), ...uv);
      } else {
        // Torso/leg x stays in its own source silhouette. A side turn changes
        // geometry, not the source view in the middle of a chest crest.
        const uv = sourceUv(p, v, center[2] >= 0 ? "front" : "back");
        vertices.push(...v, ...normal(v), ...uv);
      }
      joints.push(0, 0, 0, 0);
      weights.push(1, 0, 0, 0);
    }
  };
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const vs = corners.map((c) => pos(x + c[0], y + c[1], z + c[2])),
          ds = corners.map((c) => grid[index(x + c[0], y + c[1], z + c[2])]);
        if (ds.every((d) => d > 0) || ds.every((d) => d < 0)) continue;
        for (const tet of tets) {
          const points: V3[] = [];
          for (const [a, b] of edges) {
            const i = tet[a],
              j = tet[b];
            if (ds[i] < 0 === ds[j] < 0) continue;
            const t = ds[i] / (ds[i] - ds[j]);
            points.push(
              [0, 1, 2].map(
                (k) => vs[i][k] + (vs[j][k] - vs[i][k]) * t,
              ) as unknown as V3,
            );
          }
          if (points.length === 3) emit(points[0], points[1], points[2]);
          if (points.length === 4) {
            const center: V3 = [0, 1, 2].map(
              (k) => points.reduce((sum, p) => sum + p[k], 0) / 4,
            ) as unknown as V3;
            const axis = unit(sub(points[0], center)),
              n = unit(cross(sub(points[1], center), sub(points[2], center))),
              yaxis = cross(n, axis);
            points.sort(
              (a, b) =>
                Math.atan2(
                  dot(sub(a, center), yaxis),
                  dot(sub(a, center), axis),
                ) -
                Math.atan2(
                  dot(sub(b, center), yaxis),
                  dot(sub(b, center), axis),
                ),
            );
            emit(points[0], points[1], points[2]);
            emit(points[0], points[2], points[3]);
          }
        }
      }
  // Smooth analytic envelopes keep welded vertices identical and use at most four influences.
  for (let v = 0; v < vertices.length / 8; v++) {
    const p: V3 = [vertices[v * 8], vertices[v * 8 + 1], vertices[v * 8 + 2]],
      side = p[0] >= 0 ? "L" : "R";
    const merged = Array<number>(bones.length).fill(0);
    const ramp = (t: number) => {
      t = Math.max(0, Math.min(1, t));
      return t * t * (3 - 2 * t);
    };
    if (p[1] < 0.86 * s) {
      const hip = ramp((p[1] - 0.58 * s) / (0.28 * s)),
        thigh = ramp((p[1] - 0.37 * s) / (0.25 * s));
      const left = ramp((p[0] + 0.065 * s) / (0.13 * s));
      // At crotch the legs have already blended fully into the pelvis.
      const legSide = p[0] >= 0 ? "L" : "R";
      merged[bone(`shin.${legSide}`)] = (1 - hip) * (1 - thigh);
      merged[bone("thigh.L")] = (1 - hip) * thigh * left;
      merged[bone("thigh.R")] = (1 - hip) * thigh * (1 - left);
      merged[bone("hips")] = hip;
    } else {
      const arm =
        ramp((Math.abs(p[0]) - 0.06 * s) / (0.3 * s)) *
        ramp((p[1] - 0.86 * s) / (0.24 * s)) *
        (1 - ramp((p[1] - 1.32 * s) / (0.14 * s)));
      const forearm = 1 - ramp((p[1] - 1.01 * s) / (0.27 * s)),
        chest = ramp((p[1] - 0.92 * s) / (0.38 * s));
      merged[bone(`forearm.${side}`)] = arm * forearm;
      merged[bone(`upperArm.${side}`)] = arm * (1 - forearm);
      merged[bone("hips")] = (1 - arm) * (1 - chest);
      merged[bone("chest")] = (1 - arm) * chest;
    }
    const shoulder = bones.find((b) => b.name === "upperArm.L")!.pivot[0];
    const sleeveWrist =
      ramp((1.2 * s - p[1]) / (0.21 * s)) *
      ramp((Math.abs(p[0]) - shoulder + 0.005 * s) / (0.02 * s));
    if (p[1] > 0.9 * s && p[1] < 1.2 * s) {
      for (let j = 0; j < merged.length; j++) merged[j] *= 1 - sleeveWrist;
      merged[bone(`forearm.${side}`)] += sleeveWrist;
    }
    const top = merged
        .map((w, j) => ({ w, j }))
        .sort((a, b) => b.w - a.w)
        .slice(0, 4),
      total = top.reduce((sum, w) => sum + w.w, 0);
    for (let k = 0; k < 4; k++) {
      joints[v * 4 + k] = top[k].j;
      weights[v * 4 + k] = top[k].w / total;
    }
  }
  return {
    id: "connected-clothing",
    materialId: "reference",
    vertices: new Float32Array(vertices),
    joints: new Uint16Array(joints),
    weights: new Float32Array(weights),
  };
}
