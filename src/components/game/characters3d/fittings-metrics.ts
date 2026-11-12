import { point } from "./matrix";
import { projectCharacterGeometry } from "./project";
import { skinMatrices } from "./rig";
import type { CharacterModel, CharacterPose, V3 } from "./types";

const key = (p: readonly number[]) =>
  p.map((n) => Math.round(n * 1e6)).join(",");
/** Measures supplied triangles/weights, independently of their construction. */
export function measureCharacterFittings(
  model: CharacterModel,
  pose: CharacterPose,
) {
  const scale = model.height / 1.75,
    posed = projectCharacterGeometry(model, pose),
    matrices = skinMatrices(model, pose);
  const rib = model.meshes.find((m) => m.materialId === "rib")!,
    skin = model.meshes.find((m) => m.materialId === "skin")!,
    clothing = model.meshes.find((m) => m.id === "connected-clothing")!;
  const edges = new Map<string, number>();
  for (let i = 0; i < rib.vertices.length; i += 24) {
    const tri = [0, 8, 16].map((k) => [
      rib.vertices[i + k],
      rib.vertices[i + k + 1],
      rib.vertices[i + k + 2],
    ]);
    if (tri.some((v) => v[1] < 1.41 * scale)) continue;
    for (let j = 0; j < 3; j++) {
      const a = key(tri[j]),
        b = key(tri[(j + 1) % 3]),
        edge = a < b ? `${a}/${b}` : `${b}/${a}`;
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }
  const palm = new Map<string, number>();
  for (let i = 0; i < skin.vertices.length; i += 8) {
    const y = skin.vertices[i + 1];
    if (y > 0.93 * scale && y < 0.985 * scale)
      palm.set(key([...skin.vertices.subarray(i, i + 3)]), i);
  }
  const posedSkin = posed.find((m) => m.id === skin.id)!.vertices,
    posedRib = posed.find((m) => m.id === rib.id)!.vertices,
    shared = new Set<string>();
  let wristSeamDrift = 0;
  for (let i = 0; i < rib.vertices.length; i += 8) {
    const k = key([...rib.vertices.subarray(i, i + 3)]),
      j = palm.get(k);
    if (j === undefined) continue;
    shared.add(k);
    wristSeamDrift = Math.max(
      wristSeamDrift,
      Math.hypot(
        ...[0, 1, 2].map((axis) => posedRib[i + axis] - posedSkin[j + axis]),
      ),
    );
  }
  const posedClothing = posed.find((m) => m.id === clothing.id)!.vertices;
  let sleeveEndDeviation = 0,
    sleeveEndVertices = 0;
  for (let i = 0; i < clothing.vertices.length; i += 8) {
    const p: V3 = [
      clothing.vertices[i],
      clothing.vertices[i + 1],
      clothing.vertices[i + 2],
    ];
    if (
      p[1] < 0.93 * scale ||
      p[1] > 0.99 * scale ||
      Math.abs(p[0]) <
        model.bones.find((b) => b.name === "upperArm.L")!.pivot[0] + 0.015
    )
      continue;
    const side = p[0] > 0 ? "L" : "R",
      bone = model.bones.findIndex((b) => b.name === `forearm.${side}`),
      expected = point(matrices[bone], p);
    sleeveEndDeviation = Math.max(
      sleeveEndDeviation,
      Math.hypot(
        ...[0, 1, 2].map((axis) => posedClothing[i + axis] - expected[axis]),
      ),
    );
    sleeveEndVertices++;
  }
  return {
    collarBoundaryEdges: [...edges.values()].filter((n) => n === 1).length,
    collarNonManifoldEdges: [...edges.values()].filter((n) => n > 2).length,
    sharedWristPoints: shared.size,
    wristSeamDriftMetres: wristSeamDrift,
    sleeveEndDeviationMetres: sleeveEndDeviation,
    sleeveEndVertices,
  };
}
