/** Offline comparison renderer. No browser/profile/temp directories or timers. */

import { cross, dot, sub, unit } from "./matrix";
import { projectCharacterGeometry } from "./project";
import type { CharacterModel, CharacterPose, V3 } from "./types";

export interface ReviewTexture {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly channels: number;
}
export interface ReviewCamera {
  readonly eye: V3;
  readonly target: V3;
  readonly height: number;
}
export function renderCharacterReview(
  model: CharacterModel,
  pose: CharacterPose,
  texture: ReviewTexture,
  width: number,
  height: number,
  camera: ReviewCamera,
): Uint8Array {
  const pixels = new Uint8Array(width * height * 4),
    depth = new Float32Array(width * height).fill(-Infinity);
  for (let i = 0; i < width * height; i++)
    pixels.set([228, 231, 233, 255], i * 4);
  const forward = unit(sub(camera.eye, camera.target)),
    right = unit(cross([0, 1, 0], forward)),
    up = cross(forward, right),
    ppm = height / camera.height;
  const proj = (p: V3): V3 => {
    const d = sub(p, camera.target);
    return [
      width / 2 + dot(d, right) * ppm,
      height / 2 - dot(d, up) * ppm,
      dot(d, forward),
    ];
  };
  const batches = projectCharacterGeometry(model, pose);
  const light = unit([-0.35, 0.8, 0.6]);
  for (const mesh of batches) {
    const mat = model.materials.find((m) => m.id === mesh.materialId)!;
    const vs = mesh.vertices;
    for (let i = 0; i < vs.length; i += 24) {
      const a = proj([vs[i], vs[i + 1], vs[i + 2]]),
        b = proj([vs[i + 8], vs[i + 9], vs[i + 10]]),
        c = proj([vs[i + 16], vs[i + 17], vs[i + 18]]);
      const area =
        (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(area) < 1e-5) continue;
      const loX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))),
        hiX = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
      const loY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))),
        hiY = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
      for (let y = loY; y <= hiY; y++)
        for (let x = loX; x <= hiX; x++) {
          const aa =
            ((b[1] - c[1]) * (x + 0.5 - c[0]) +
              (c[0] - b[0]) * (y + 0.5 - c[1])) /
            area;
          const bb =
              ((c[1] - a[1]) * (x + 0.5 - c[0]) +
                (a[0] - c[0]) * (y + 0.5 - c[1])) /
              area,
            cc = 1 - aa - bb;
          if (aa < 0 || bb < 0 || cc < 0) continue;
          const z = aa * a[2] + bb * b[2] + cc * c[2],
            offset = y * width + x;
          if (z <= depth[offset]) continue;
          depth[offset] = z;
          const interp = (k: number) =>
            vs[i + k] * aa + vs[i + 8 + k] * bb + vs[i + 16 + k] * cc;
          const normal = unit([interp(3), interp(4), interp(5)]);
          const illumination = 0.79 + 0.22 * Math.max(0, dot(normal, light));
          let color: number[] = [...mat.color].map((n) => n * 255);
          if (mat.texture) {
            const tx = Math.max(
                0,
                Math.min(
                  texture.width - 1,
                  Math.round(interp(6) * texture.width),
                ),
              ),
              ty = Math.max(
                0,
                Math.min(
                  texture.height - 1,
                  Math.round(interp(7) * texture.height),
                ),
              );
            const t = (ty * texture.width + tx) * texture.channels;
            color = [texture.data[t], texture.data[t + 1], texture.data[t + 2]];
          }
          pixels.set(
            color.map((n) =>
              Math.max(0, Math.min(255, Math.round(n * illumination))),
            ),
            offset * 4,
          );
        }
    }
  }
  return pixels;
}
