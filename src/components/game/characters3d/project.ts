import { skinMatrices } from "./rig";
import type {
  CharacterModel,
  CharacterPose,
  ProjectedCharacterBatch,
} from "./types";

/** CPU LBS, output compatible with the native WebGL2 table vertex layout. */
export function projectCharacterGeometry(
  model: CharacterModel,
  pose: CharacterPose,
): readonly ProjectedCharacterBatch[] {
  const matrices = skinMatrices(model, pose);
  return model.meshes.map((mesh) => {
    const out = new Float32Array(mesh.vertices.length);
    const v = mesh.vertices;
    for (let i = 0; i < v.length / 8; i++) {
      const offset = i * 8,
        skin = i * 4;
      const closure = pose.handClosure ?? 0,
        morph = mesh.handClosure;
      const x = v[offset] + (morph?.positions[i * 3] ?? 0) * closure,
        y = v[offset + 1] + (morph?.positions[i * 3 + 1] ?? 0) * closure,
        z = v[offset + 2] + (morph?.positions[i * 3 + 2] ?? 0) * closure;
      const nx = v[offset + 3] + (morph?.normals[i * 3] ?? 0) * closure,
        ny = v[offset + 4] + (morph?.normals[i * 3 + 1] ?? 0) * closure,
        nz = v[offset + 5] + (morph?.normals[i * 3 + 2] ?? 0) * closure;
      let px = 0,
        py = 0,
        pz = 0,
        ax = 0,
        ay = 0,
        az = 0;
      for (let influence = 0; influence < 4; influence++) {
        const w = mesh.weights[skin + influence];
        if (w === 0) continue;
        const m = matrices[mesh.joints[skin + influence]];
        px += w * (m[0] * x + m[4] * y + m[8] * z + m[12]);
        py += w * (m[1] * x + m[5] * y + m[9] * z + m[13]);
        pz += w * (m[2] * x + m[6] * y + m[10] * z + m[14]);
        ax += w * (m[0] * nx + m[4] * ny + m[8] * nz);
        ay += w * (m[1] * nx + m[5] * ny + m[9] * nz);
        az += w * (m[2] * nx + m[6] * ny + m[10] * nz);
      }
      const length = Math.hypot(ax, ay, az);
      out[offset] = px;
      out[offset + 1] = py;
      out[offset + 2] = pz;
      out[offset + 3] = length > 1e-12 ? ax / length : 0;
      out[offset + 4] = length > 1e-12 ? ay / length : 1;
      out[offset + 5] = length > 1e-12 ? az / length : 0;
      out[offset + 6] = v[offset + 6];
      out[offset + 7] = v[offset + 7];
    }
    return {
      id: mesh.id,
      materialId: mesh.materialId,
      vertices: out,
      ...(mesh.colors ? { colors: mesh.colors } : {}),
    };
  });
}
