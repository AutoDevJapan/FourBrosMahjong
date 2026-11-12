import { describe, expect, it } from "vitest";
import { sampleCharacterPose } from "../characters3d/clips";
import { point, unit } from "../characters3d/matrix";
import { createCharacterModel } from "../characters3d/model";
import { projectCharacterGeometry } from "../characters3d/project";
import { skinMatrices } from "../characters3d/rig";

describe("character projection fidelity", () => {
  it.each(["p0", "p1", "p2", "p3"] as const)(
    "%s matches independent weighted point transforms for position, normal and UV",
    (id) => {
      const model = createCharacterModel(id);
      for (const clip of ["standing-reference", "call", "kita"] as const) {
        const pose = sampleCharacterPose(model, clip, 0.37);
        if (id === "p2" && clip !== "standing-reference")
          expect(pose.handClosure).toBeGreaterThan(0);
        const matrices = skinMatrices(model, pose);
        const projected = projectCharacterGeometry(model, pose);
        for (const [meshIndex, mesh] of model.meshes.entries()) {
          const vertices = projected[meshIndex].vertices;
          for (
            let vertex = 0;
            vertex < mesh.vertices.length / 8;
            vertex += 37
          ) {
            const offset = vertex * 8;
            const normal = [0, 0, 0];
            const position = [0, 0, 0];
            // Morph targets are relative object-space deltas, applied before
            // skinning. Keep this oracle independent of the projection loop.
            const inputPosition = [0, 1, 2].map(
              (axis) =>
                mesh.vertices[offset + axis] +
                (mesh.handClosure?.positions[vertex * 3 + axis] ?? 0) *
                  (pose.handClosure ?? 0),
            );
            const inputNormal = [0, 1, 2].map(
              (axis) =>
                mesh.vertices[offset + axis + 3] +
                (mesh.handClosure?.normals[vertex * 3 + axis] ?? 0) *
                  (pose.handClosure ?? 0),
            );
            for (let influence = 0; influence < 4; influence++) {
              const weight = mesh.weights[vertex * 4 + influence];
              if (weight === 0) continue;
              const matrix = matrices[mesh.joints[vertex * 4 + influence]];
              const p = point(matrix, [
                inputPosition[0],
                inputPosition[1],
                inputPosition[2],
              ]);
              const n = point(
                matrix,
                [inputNormal[0], inputNormal[1], inputNormal[2]],
                true,
              );
              for (let axis = 0; axis < 3; axis++) {
                position[axis] += p[axis] * weight;
                normal[axis] += n[axis] * weight;
              }
            }
            const expectedNormal = unit([normal[0], normal[1], normal[2]]);
            for (let axis = 0; axis < 3; axis++) {
              expect(vertices[offset + axis]).toBeCloseTo(position[axis], 5);
              expect(vertices[offset + axis + 3]).toBeCloseTo(
                expectedNormal[axis],
                5,
              );
            }
            expect(vertices[offset + 6]).toBe(mesh.vertices[offset + 6]);
            expect(vertices[offset + 7]).toBe(mesh.vertices[offset + 7]);
          }
        }
      }
    },
  );
});
