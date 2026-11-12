import type { Vec3 } from "./scene";

/** Interleaved xyz, normal xyz, uv. Shared by all tile instances. */
export function beveledBox(bevel = 0.055): Float32Array {
  const out: number[] = [];
  const h = 0.5,
    inner = h - bevel;
  const polygon = (vertices: Vec3[], outward: Vec3) => {
    const a = vertices[0],
      b = vertices[1],
      c = vertices[2];
    const u = b.map((v, i) => v - a[i]),
      v = c.map((n, i) => n - a[i]);
    let normal = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
    if (normal.reduce((sum, n, i) => sum + n * outward[i], 0) < 0) {
      vertices.reverse();
      normal = normal.map((n) => -n);
    }
    const length = Math.hypot(...normal);
    normal = normal.map((n) => n / length);
    for (let i = 1; i < vertices.length - 1; i++)
      for (const point of [vertices[0], vertices[i], vertices[i + 1]]) {
        out.push(...point, ...normal, point[0] + 0.5, point[2] + 0.5);
      }
  };
  for (let axis = 0; axis < 3; axis++)
    for (const sign of [-1, 1]) {
      const b = (axis + 1) % 3,
        c = (axis + 2) % 3;
      const vertices = [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([s, t]) => {
        const p = [0, 0, 0];
        p[axis] = sign * h;
        p[b] = s * inner;
        p[c] = t * inner;
        return p as unknown as Vec3;
      });
      const n = [0, 0, 0];
      n[axis] = sign;
      polygon(vertices, n as unknown as Vec3);
    }
  if (bevel > 0) {
    for (let axis = 0; axis < 3; axis++)
      for (const s of [-1, 1])
        for (const t of [-1, 1]) {
          const b = (axis + 1) % 3,
            c = (axis + 2) % 3;
          const p = (a: number, bb: number, cc: number): Vec3 => {
            const result = [0, 0, 0];
            result[axis] = a;
            result[b] = s * bb;
            result[c] = t * cc;
            return result as unknown as Vec3;
          };
          polygon(
            [
              p(-inner, h, inner),
              p(inner, h, inner),
              p(inner, inner, h),
              p(-inner, inner, h),
            ],
            p(0, 1, 1),
          );
        }
    for (const x of [-1, 1])
      for (const y of [-1, 1])
        for (const z of [-1, 1]) {
          polygon(
            [
              [x * h, y * inner, z * inner],
              [x * inner, y * h, z * inner],
              [x * inner, y * inner, z * h],
            ],
            [x, y, z],
          );
        }
  }
  return new Float32Array(out);
}

/** The face sits just above the solid top. UV v=0 is the image's upper edge. */
export const FACE_VERTICES = new Float32Array([
  -0.435, 0.515, -0.435, 0, 1, 0, 0, 0, 0.435, 0.515, -0.435, 0, 1, 0, 1, 0,
  0.435, 0.515, 0.435, 0, 1, 0, 1, 1, -0.435, 0.515, -0.435, 0, 1, 0, 0, 0,
  0.435, 0.515, 0.435, 0, 1, 0, 1, 1, -0.435, 0.515, 0.435, 0, 1, 0, 0, 1,
]);
