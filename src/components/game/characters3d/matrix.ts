import type { M4, V3 } from "./types";

const identity = (): M4 =>
  new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
export function multiply(a: M4, b: M4): M4 {
  const c = new Float32Array(16);
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 4; i++)
      c[j * 4 + i] =
        a[i] * b[j * 4] +
        a[4 + i] * b[j * 4 + 1] +
        a[8 + i] * b[j * 4 + 2] +
        a[12 + i] * b[j * 4 + 3];
  return c;
}
export function translation(p: V3): M4 {
  const m = identity();
  m[12] = p[0];
  m[13] = p[1];
  m[14] = p[2];
  return m;
}
/** Column vectors, local Euler X then Y then Z; no scale in the rig. */
export function rotation([x, y, z]: V3): M4 {
  const a = Math.cos(x),
    b = Math.sin(x),
    c = Math.cos(y),
    d = Math.sin(y),
    e = Math.cos(z),
    f = Math.sin(z);
  return new Float32Array([
    c * e,
    c * f,
    -d,
    0,
    b * d * e - a * f,
    b * d * f + a * e,
    b * c,
    0,
    a * d * e + b * f,
    a * d * f - b * e,
    a * c,
    0,
    0,
    0,
    0,
    1,
  ]);
}
export const add = (a: V3, b: V3): V3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
export const sub = (a: V3, b: V3): V3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export function unit(a: V3): V3 {
  const n = Math.hypot(...a);
  return n > 1e-12 ? scale(a, 1 / n) : [0, 1, 0];
}
export function point(m: M4, p: V3, direction = false): V3 {
  const w = direction ? 0 : 1;
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + w * m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + w * m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + w * m[14],
  ];
}
