import type { Vec3 } from "./scene";

export type Matrix4 = Float32Array<ArrayBuffer>;

function multiply(a: Matrix4, b: Matrix4): Matrix4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  return out;
}

export function transform(center: Vec3, rotation: Vec3, size: Vec3): Matrix4 {
  const cx = Math.cos(rotation[0]),
    sx = Math.sin(rotation[0]);
  const cy = Math.cos(rotation[1]),
    sy = Math.sin(rotation[1]);
  return new Float32Array([
    cy * size[0],
    0,
    -sy * size[0],
    0,
    sy * sx * size[1],
    cx * size[1],
    cy * sx * size[1],
    0,
    sy * cx * size[2],
    -sx * size[2],
    cy * cx * size[2],
    0,
    center[0],
    center[1],
    center[2],
    1,
  ]);
}

function unit(v: Vec3): Vec3 {
  const length = Math.hypot(...v);
  return [v[0] / length, v[1] / length, v[2] / length];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Fixed tabletop camera; portrait viewports pull back to preserve the whole table. */
export function camera(aspect: number): Matrix4 {
  const fov = (42 * Math.PI) / 180;
  const distance = Math.max(36, 39 / Math.max(aspect, 0.1));
  const eye: Vec3 = [0, distance * 0.79, distance * 0.613];
  const z = unit(eye),
    x = unit(cross([0, 1, 0], z)),
    y = cross(z, x);
  const view = new Float32Array([
    x[0],
    y[0],
    z[0],
    0,
    x[1],
    y[1],
    z[1],
    0,
    x[2],
    y[2],
    z[2],
    0,
    -dot(x, eye),
    -dot(y, eye),
    -dot(z, eye),
    1,
  ]);
  // The table is beyond the near plane; use its depth range for face precision.
  const f = 1 / Math.tan(fov / 2),
    near = 1,
    far = distance + 100;
  const projection = new Float32Array([
    f / aspect,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + near) / (near - far),
    -1,
    0,
    0,
    (2 * far * near) / (near - far),
    0,
  ]);
  return multiply(projection, view);
}

export interface ProjectedPoint {
  readonly x: number;
  readonly y: number;
  readonly depth: number;
  readonly visible: boolean;
}
export function project(
  matrix: Matrix4,
  p: Vec3,
  width: number,
  height: number,
): ProjectedPoint {
  const w =
    matrix[3] * p[0] + matrix[7] * p[1] + matrix[11] * p[2] + matrix[15];
  const x =
    (matrix[0] * p[0] + matrix[4] * p[1] + matrix[8] * p[2] + matrix[12]) / w;
  const y =
    (matrix[1] * p[0] + matrix[5] * p[1] + matrix[9] * p[2] + matrix[13]) / w;
  const z =
    (matrix[2] * p[0] + matrix[6] * p[1] + matrix[10] * p[2] + matrix[14]) / w;
  return {
    x: ((x + 1) * width) / 2,
    y: ((1 - y) * height) / 2,
    depth: z,
    visible: w > 0 && Math.abs(x) <= 1 && Math.abs(y) <= 1 && Math.abs(z) <= 1,
  };
}
export function localPoint(matrix: Matrix4, p: Vec3): Vec3 {
  return [
    matrix[0] * p[0] + matrix[4] * p[1] + matrix[8] * p[2] + matrix[12],
    matrix[1] * p[0] + matrix[5] * p[1] + matrix[9] * p[2] + matrix[13],
    matrix[2] * p[0] + matrix[6] * p[1] + matrix[10] * p[2] + matrix[14],
  ];
}
export function insideTriangle(
  x: number,
  y: number,
  a: ProjectedPoint,
  b: ProjectedPoint,
  c: ProjectedPoint,
): boolean {
  const edge = (p: ProjectedPoint, q: ProjectedPoint) =>
    (x - q.x) * (p.y - q.y) - (p.x - q.x) * (y - q.y);
  const d1 = edge(a, b),
    d2 = edge(b, c),
    d3 = edge(c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
