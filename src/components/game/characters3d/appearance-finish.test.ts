import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { CHARACTER_CLIPS, sampleCharacterPose } from "./clips";
import { exportCharacterGlb } from "./glb";
import { createCharacterModel } from "./model";
import { MODEL_PROFILES } from "./profiles";
import { projectCharacterGeometry } from "./project";

type Glb = {
  skins: { joints: number[] }[];
  accessors: { bufferView: number; count: number }[];
  bufferViews: { byteOffset: number }[];
  meshes: {
    weights?: number[];
    primitives: {
      attributes: Record<string, number>;
      targets?: { POSITION: number }[];
    }[];
  }[];
  animations: { channels: { target: { path: string } }[] }[];
};
const models = (["p0", "p1", "p2", "p3"] as const).map((id) =>
  createCharacterModel(id),
);
const req = createRequire(resolve("package.json")),
  sharp = createRequire(req.resolve("next/package.json"))("sharp");
it.each(models)(
  "$id joins corresponding skin texels within a small color difference",
  async (model) => {
    const raw = await sharp(model.materials.find((m) => m.texture)!.texture!)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true }),
      mesh = model.meshes.find((m) => m.id === "surface-reference")!,
      v = mesh.vertices,
      p = MODEL_PROFILES[model.id],
      pairs = new Map<string, { u: number; rgb: number[] }[]>();
    for (let k = 0; k < v.length; k += 8) {
      if (
        v[k + 1] < p.height - p.headLength + 0.01 ||
        v[k + 1] > p.height - 0.07 ||
        v[k + 2] < 0.03
      )
        continue;
      const x = Math.round(v[k + 6] * raw.info.width),
        y = Math.round(v[k + 7] * raw.info.height),
        o = (y * raw.info.width + x) * raw.info.channels,
        rgb = Array.from(raw.data.subarray(o, o + 3)) as number[];
      if (Math.min(...rgb) < 65 || rgb[0] < rgb[2] * 1.12) continue;
      const key = Array.from(v.subarray(k, k + 3))
          .map((n) => Math.round(n * 1e5))
          .join(","),
        arr = pairs.get(key) ?? [];
      if (!arr.some((row) => Math.abs(row.u - v[k + 6]) < 1e-6))
        arr.push({
          u: v[k + 6],
          rgb: rgb.map(
            (n, c) =>
              n * Math.pow(mesh.colors?.[(k / 8) * 3 + c] ?? 1, 1 / 2.2),
          ),
        });
      pairs.set(key, arr);
    }
    const errors = [...pairs.values()]
      .filter((a) => a.length === 2 && Math.abs(a[0].u - a[1].u) > 0.1)
      .map((a) => Math.hypot(...a[0].rgb.map((n, c) => n - a[1].rgb[c])));
    expect(errors.length).toBeGreaterThanOrEqual(8);
    expect(errors.reduce((a, b) => a + b, 0) / errors.length).toBeLessThan(3);
    expect(Math.max(...errors)).toBeLessThan(8);
    expect(mesh.colors).toHaveLength((v.length / 8) * 3);
    expect(
      mesh.colors!.every((c) => Number.isFinite(c) && c >= 0 && c <= 1),
    ).toBe(true);
  },
);
it("p2 closes fingers during reactions and returns to the exact open pose", () => {
  const model = models[2],
    skin = model.meshes.find((m) => m.materialId === "skin")!,
    morph = skin.handClosure;
  expect(morph).toBeDefined();
  expect(morph!.positions.length).toBe((skin.vertices.length / 8) * 3);
  let moved = 0,
    nearWrist = 0;
  for (let v = 0; v < skin.vertices.length / 8; v++) {
    const d = Math.hypot(...morph!.positions.subarray(v * 3, v * 3 + 3));
    if (d > 0.005) moved++;
    if (skin.vertices[v * 8 + 1] > 0.93) nearWrist = Math.max(nearWrist, d);
  }
  expect(moved).toBeGreaterThan(200);
  expect(nearWrist).toBe(0);
  for (const clip of [
    "declare",
    "call",
    "kita",
    "win-tsumo",
    "win-ron",
  ] as const) {
    const spec = CHARACTER_CLIPS[clip],
      pose = sampleCharacterPose(model, clip, spec.duration * 0.4);
    expect(pose.handClosure).toBeGreaterThan(0.3);
    expect(sampleCharacterPose(model, clip, 0).handClosure).toBe(0);
    expect(sampleCharacterPose(model, clip, spec.duration).handClosure).toBe(0);
    expect(
      sampleCharacterPose(model, clip, spec.duration * 0.4, true).handClosure,
    ).toBe(0);
    const posed = projectCharacterGeometry(model, pose),
      open = projectCharacterGeometry(model, { ...pose, handClosure: 0 });
    let difference = 0;
    for (let m = 0; m < posed.length; m++)
      for (let k = 0; k < posed[m].vertices.length; k += 8)
        difference = Math.max(
          difference,
          Math.hypot(
            ...[0, 1, 2].map(
              (c) => posed[m].vertices[k + c] - open[m].vertices[k + c],
            ),
          ),
        );
    expect(difference).toBeGreaterThan(0.01);
  }
  for (const m of models.filter((m) => m.id !== "p2"))
    expect(m.meshes.some((q) => q.handClosure)).toBe(false);
});
it.each(models)(
  "$id exports exact colors and p2 weights without new bones or textures",
  (model) => {
    const bytes = exportCharacterGlb(
        model,
        readFileSync(model.materials.find((m) => m.texture)!.texture!),
      ),
      jsonLength = new DataView(bytes.buffer).getUint32(12, true),
      json = JSON.parse(
        new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)),
      ) as Glb,
      bin = 20 + jsonLength + 8;
    expect(json.skins[0].joints).toHaveLength(19);
    expect(json.animations).toHaveLength(13);
    for (let i = 0; i < model.meshes.length; i++) {
      const mesh = model.meshes[i],
        p = json.meshes[0].primitives[i];
      if (mesh.colors) {
        const a = json.accessors[p.attributes.COLOR_0],
          b = json.bufferViews[a.bufferView],
          colors = new Float32Array(
            bytes.buffer,
            bin + b.byteOffset,
            a.count * 3,
          );
        expect(colors).toEqual(mesh.colors);
      }
      if (mesh.handClosure) {
        const a = json.accessors[p.targets![0].POSITION],
          b = json.bufferViews[a.bufferView];
        expect(
          new Float32Array(bytes.buffer, bin + b.byteOffset, a.count * 3),
        ).toEqual(mesh.handClosure.positions);
      }
    }
    if (model.id === "p2") {
      expect(json.meshes[0].weights).toEqual([0]);
      expect(
        json.animations.every((a) =>
          a.channels.some((c) => c.target.path === "weights"),
        ),
      ).toBe(true);
    } else expect(json.meshes[0].weights).toBeUndefined();
  },
);
