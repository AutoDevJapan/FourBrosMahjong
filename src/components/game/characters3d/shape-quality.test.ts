import { describe, expect, it } from "vitest";
import { CHARACTER_CLIPS, sampleCharacterPose } from "./clips";
import { measureCharacterFittings } from "./fittings-metrics";
import { createCharacterModel } from "./model";
import { MODEL_PROFILES } from "./profiles";
import { projectCharacterGeometry } from "./project";
import { type CharacterModel, CLIP_IDS } from "./types";

const models = (["p0", "p1", "p2", "p3"] as const).map((id) =>
  createCharacterModel(id),
);
const expected = [10876, 10740, 11996, 11420];
function sections(m: CharacterModel, sign: number) {
  const v = m.meshes.find((q) => q.materialId === "skin")!.vertices,
    s = m.height / 1.75;
  return [0.849, 0.858, 0.865].map((y) => {
    const ranges: number[][] = [];
    for (let k = 0; k < v.length; k += 24) {
      const vs = [0, 8, 16].map((i) => [v[k + i] * sign, v[k + i + 1] / s]);
      if (vs.some((p) => p[0] <= 0)) continue;
      const xs = [];
      for (let i = 0; i < 3; i++) {
        const a = vs[i],
          b = vs[(i + 1) % 3];
        if ((a[1] <= y && b[1] > y) || (a[1] > y && b[1] <= y))
          xs.push(a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]));
      }
      if (xs.length === 2) ranges.push([Math.min(...xs), Math.max(...xs)]);
    }
    ranges.sort((a, b) => a[0] - b[0]);
    const merged: number[][] = [];
    for (const r of ranges) {
      if (merged.length && r[0] <= merged.at(-1)![1] + 1e-6)
        merged.at(-1)![1] = Math.max(merged.at(-1)![1], r[1]);
      else merged.push([...r]);
    }
    return merged;
  });
}
describe("character shape repair acceptance, original thresholds retained", () => {
  it("retains the exact triangle, bone and clip budgets", () => {
    expect(Object.keys(CHARACTER_CLIPS)).toHaveLength(13);
    expect(
      models.map((m) =>
        m.meshes.reduce((n, q) => n + q.vertices.length / 24, 0),
      ),
    ).toEqual(expected);
    expect(expected.reduce((a, b) => a + b, 0)).toBe(45032);
    for (const m of models) expect(m.bones).toHaveLength(19);
  });
  it.each(models)("$id separates four distal digits on both hands", (m) => {
    for (const sign of [-1, 1])
      for (const slice of sections(m, sign)) {
        expect(slice.length).toBe(4);
        expect(
          slice
            .slice(1)
            .every((r, i) => r[0] - slice[i][1] > 0.001 * (m.height / 1.75)),
        ).toBe(true);
      }
  });
  it.each(models)(
    "$id recesses the throat behind the jaw with a connected contour",
    (m) => {
      const p = MODEL_PROFILES[m.id],
        chin = p.height - p.headLength - 0.025,
        s = p.height / 1.75,
        v = m.meshes.find((q) => q.id === "surface-reference")!.vertices;
      const throat = [],
        jaw = [];
      for (let k = 0; k < v.length; k += 8) {
        if (Math.abs(v[k]) > 0.012) continue;
        if (v[k + 1] > 1.475 * s && v[k + 1] < chin + 0.012)
          throat.push(v[k + 2]);
        if (v[k + 1] >= chin + 0.012 && v[k + 1] < chin + 0.05)
          jaw.push(v[k + 2]);
      }
      expect(throat.length).toBeGreaterThan(20);
      expect(jaw.length).toBeGreaterThan(20);
      expect(Math.max(...throat)).toBeLessThan(0.06 * s);
      expect(Math.max(...jaw) - Math.max(...throat)).toBeGreaterThan(0.025 * s);
    },
  );
  it.each(models)(
    "$id never interpolates a head triangle across source sheet columns",
    (m) => {
      let count = 0,
        max = 0;
      for (const mesh of m.meshes.filter((q) => q.materialId === "reference"))
        for (let k = 0; k < mesh.vertices.length; k += 24) {
          const v = mesh.vertices;
          if (
            Math.max(v[k + 1], v[k + 9], v[k + 17]) <
            (1.45 * m.height) / 1.75
          )
            continue;
          const u = [v[k + 6], v[k + 14], v[k + 22]];
          max = Math.max(max, Math.max(...u) - Math.min(...u));
          count++;
        }
      expect(count).toBeGreaterThan(1000);
      expect(max).toBeLessThan(0.08);
    },
  );
  it.each(models)(
    "$id keeps collar and wrist junctions attached through all 13 clips",
    (m) => {
      for (const clip of CLIP_IDS)
        for (const fraction of [
          0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1,
        ]) {
          const pose = sampleCharacterPose(
              m,
              clip,
              CHARACTER_CLIPS[clip].duration * fraction,
            ),
            f = measureCharacterFittings(m, pose);
          expect(f.sharedWristPoints).toBeGreaterThanOrEqual(48);
          expect(f.collarBoundaryEdges).toBe(0);
          expect(f.collarNonManifoldEdges).toBe(0);
          expect(f.wristSeamDriftMetres).toBeLessThan(1e-6);
          expect(f.sleeveEndVertices).toBeGreaterThan(10);
          expect(f.sleeveEndDeviationMetres).toBeLessThan(0.001);
        }
    },
  );
  it.each(models)(
    "$id keeps coincident head seam vertices coincident during jaw/head motion",
    (m) => {
      const mesh = m.meshes.find((q) => q.id === "surface-reference")!,
        pairs: [number, number][] = [],
        seen = new Map<string, number>();
      for (let k = 0; k < mesh.vertices.length; k += 8) {
        if (mesh.vertices[k + 1] < (1.43 * m.height) / 1.75) continue;
        const key = Array.from(mesh.vertices.subarray(k, k + 3))
          .map((x) => Math.round(x * 1e6))
          .join(",");
        if (seen.has(key)) pairs.push([seen.get(key)!, k]);
        else seen.set(key, k);
      }
      expect(pairs.length).toBeGreaterThan(100);
      for (const clip of [
        "seated-idle",
        "declare",
        "call",
        "kita",
        "win-tsumo",
        "win-ron",
      ] as const)
        for (const fraction of [0, 0.25, 0.4, 0.75, 1]) {
          const posed = projectCharacterGeometry(
            m,
            sampleCharacterPose(
              m,
              clip,
              CHARACTER_CLIPS[clip].duration * fraction,
            ),
          ).find((q) => q.id === mesh.id)!.vertices;
          let drift = 0;
          for (const [a, b] of pairs)
            drift = Math.max(
              drift,
              Math.hypot(
                posed[a] - posed[b],
                posed[a + 1] - posed[b + 1],
                posed[a + 2] - posed[b + 2],
              ),
            );
          expect(drift).toBeLessThan(2e-6);
        }
    },
  );
});

type SurfacePoint = { point: number[]; vertex: number };
function skinComponents(model: CharacterModel, sign: number): SurfacePoint[][] {
  const v = model.meshes.find((q) => q.materialId === "skin")!.vertices,
    parents: number[] = [],
    points: SurfacePoint[] = [],
    lookup = new Map<string, number>();
  const find = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  for (let k = 0; k < v.length; k += 24) {
    if (v[k] * sign <= 0) continue;
    const triangle: number[] = [];
    for (const offset of [0, 8, 16]) {
      const point = Array.from(v.subarray(k + offset, k + offset + 3)),
        key = point.map((n) => Math.round(n * 1e6)).join(",");
      let index = lookup.get(key);
      if (index === undefined) {
        index = parents.length;
        lookup.set(key, index);
        parents.push(index);
        points.push({ point, vertex: k + offset });
      }
      triangle.push(index);
    }
    for (let j = 0; j < 3; j++)
      parents[find(triangle[j])] = find(triangle[(j + 1) % 3]);
  }
  const groups = new Map<number, SurfacePoint[]>();
  for (let j = 0; j < points.length; j++) {
    const root = find(j),
      group = groups.get(root) ?? [];
    group.push(points[j]);
    groups.set(root, group);
  }
  return [...groups.values()];
}
it.each(models)(
  "$id attaches every digit root inside the palm and follows the same hand bone",
  (m) => {
    const skin = m.meshes.find((q) => q.materialId === "skin")!;
    for (const sign of [-1, 1]) {
      const groups = skinComponents(m, sign),
        palm = groups.find(
          (g) =>
            Math.max(...g.map((q) => q.point[1])) > 0.95 * (m.height / 1.75) &&
            Math.min(...g.map((q) => q.point[1])) < 0.9 * (m.height / 1.75),
        )!;
      expect(palm).toBeDefined();
      const mins = [0, 1, 2].map((k) =>
          Math.min(...palm.map((q) => q.point[k])),
        ),
        maxs = [0, 1, 2].map((k) => Math.max(...palm.map((q) => q.point[k]))),
        center = mins.map((n, k) => (n + maxs[k]) / 2),
        radius = mins.map((n, k) => (maxs[k] - n) / 2),
        digits = groups.filter(
          (g) =>
            Math.max(...g.map((q) => q.point[1])) < 0.94 * (m.height / 1.75) &&
            Math.min(...g.map((q) => q.point[1])) < 0.9 * (m.height / 1.75),
        );
      expect(digits).toHaveLength(5);
      const hand = m.bones.findIndex(
        (b) => b.name === (sign > 0 ? "hand.L" : "hand.R"),
      );
      for (const digit of digits) {
        const minimum = Math.min(
          ...digit.map((q) =>
            q.point.reduce(
              (sum, v, k) => sum + ((v - center[k]) / radius[k]) ** 2,
              0,
            ),
          ),
        );
        expect(minimum).toBeLessThan(0.95);
        for (const q of digit) {
          expect(skin.weights[q.vertex / 2]).toBe(1);
          expect(skin.joints[q.vertex / 2]).toBe(hand);
        }
      }
    }
  },
);
