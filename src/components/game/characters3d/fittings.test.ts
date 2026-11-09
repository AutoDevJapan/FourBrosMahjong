import { createRequire } from "node:module";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CHARACTER_CLIPS, sampleCharacterPose } from "./clips";
import { measureCharacterFittings } from "./fittings-metrics";
import { createCharacterModel } from "./model";

const models = (["p0", "p1", "p2", "p3"] as const).map((id) =>
  createCharacterModel(id),
);
describe("visible neck and wrist attachment regressions", () => {
  it.each(models)(
    "$id has a closed collar and a shared wrist boundary",
    (model) => {
      const metrics = measureCharacterFittings(
        model,
        sampleCharacterPose(model, "standing-reference", 0),
      );
      expect(metrics.collarBoundaryEdges).toBe(0);
      expect(metrics.collarNonManifoldEdges).toBe(0);
      expect(metrics.sharedWristPoints).toBeGreaterThanOrEqual(48);
    },
  );
  it.each(models)(
    "$id sleeves and wrist skin stay attached during draw/call",
    (model) => {
      for (const clip of ["draw", "call"] as const)
        for (const t of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
          const metrics = measureCharacterFittings(
            model,
            sampleCharacterPose(
              model,
              clip,
              CHARACTER_CLIPS[clip].duration * t,
            ),
          );
          expect(metrics.sleeveEndVertices).toBeGreaterThan(10);
          expect(
            metrics.sleeveEndDeviationMetres,
            `${clip} ${t} sleeve follows cuff`,
          ).toBeLessThan(0.001);
          expect(
            metrics.wristSeamDriftMetres,
            `${clip} ${t} skin follows cuff`,
          ).toBeLessThan(0.000001);
          expect(metrics.sharedWristPoints).toBeGreaterThanOrEqual(48);
        }
    },
  );
  it("p2 rear scalp samples dark textured hair rather than sheet background/skin fill", async () => {
    const require = createRequire(resolve("package.json")),
      sharp = createRequire(require.resolve("next/package.json"))("sharp");
    const model = models[2],
      texture = model.materials.find((m) => m.texture)!.texture!;
    const { data, info } = await sharp(texture)
      .raw()
      .toBuffer({ resolveWithObject: true });
    let count = 0,
      pale = 0,
      sum = 0;
    for (const mesh of model.meshes.filter((m) => m.materialId === "reference"))
      for (let i = 0; i < mesh.vertices.length; i += 8) {
        const v = mesh.vertices;
        if (v[i + 1] < 1.58 || v[i + 1] > 1.64 || v[i + 2] > -0.055) continue;
        const x = Math.max(
            0,
            Math.min(info.width - 1, Math.round(v[i + 6] * info.width)),
          ),
          y = Math.max(
            0,
            Math.min(info.height - 1, Math.round(v[i + 7] * info.height)),
          ),
          offset = (y * info.width + x) * info.channels;
        const rgb = [data[offset], data[offset + 1], data[offset + 2]];
        const light = (rgb[0] + rgb[1] + rgb[2]) / (3 * 255);
        count++;
        sum += light;
        // Neutral hair highlights are legitimate. Count pale background or the
        // warm flat skin extension that caused the missing rear scalp in v5.
        if (light > 0.55 || (rgb[0] > rgb[2] * 1.35 && rgb[0] > 90)) pale++;
      }
    expect(count).toBeGreaterThan(100);
    expect(pale / count).toBeLessThan(0.02);
    expect(sum / count).toBeLessThan(0.2);
  });
});
