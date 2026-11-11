/** Isolated review entry; never imported by the production route. */

import type { CharacterPlayerId } from "@/domain/game/characters";
import { CHARACTER_CLIPS, sampleCharacterPose } from "./clips";
import { cross, dot, multiply, sub, unit } from "./matrix";
import { createCharacterModel } from "./model";
import { projectCharacterGeometry } from "./project";
import {
  type CharacterClipId,
  type CharacterModel,
  CLIP_IDS,
  type V3,
} from "./types";

type View = "front" | "side" | "back" | "table";
const VERTEX = `#version 300 es
layout(location=0) in vec3 p;layout(location=1) in vec3 n;layout(location=2) in vec2 uv;layout(location=3) in vec3 tint;
uniform mat4 camera;out vec3 normal;out vec2 texcoord;out vec3 vertexTint;
void main(){gl_Position=camera*vec4(p,1.);normal=n;texcoord=uv;vertexTint=tint;}`;
const FRAGMENT = `#version 300 es
precision highp float;in vec3 normal;in vec2 texcoord;in vec3 vertexTint;uniform vec3 color;uniform bool textured;uniform sampler2D image;out vec4 frag;
void main(){vec3 c=color;if(textured)c*=texture(image,texcoord).rgb;float light=.75+.27*max(dot(normalize(normal),normalize(vec3(-.35,.8,.6))),0.);frag=vec4(c*pow(vertexTint,vec3(1./2.2))*light,1.);}`;
function camera(
  eye: V3,
  target: V3,
  aspect: number,
  span: number,
  perspective = false,
) {
  const z = unit(sub(eye, target)),
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
  const near = 0.01,
    far = 30;
  const p = perspective
    ? new Float32Array([
        2 / aspect,
        0,
        0,
        0,
        0,
        2,
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
      ])
    : new Float32Array([
        2 / (span * aspect),
        0,
        0,
        0,
        0,
        2 / span,
        0,
        0,
        0,
        0,
        -2 / (far - near),
        0,
        0,
        0,
        -(far + near) / (far - near),
        1,
      ]);
  return multiply(p, view);
}
const root = document.querySelector<HTMLElement>("#review")!;
root.innerHTML = `<h1>四兄弟3D — 未承認候補</h1><p>原本と同じモデルsourceをWebGL2で表示。通常対局への接続・最終外見の承認は未実施。</p>
<nav><label>人物 <select id="actor"><option value="p0">粗悪品</option><option value="p1">竜二</option><option value="p2">マサキ</option><option value="p3">糸瓜</option></select></label>
<label>動作 <select id="clip">${CLIP_IDS.map((id) => `<option value="${id}">${id}</option>`).join("")}</select></label><button id="play">再生</button><button id="restart">先頭</button><label><input type="checkbox" id="reduced">動きを抑える</label></nav>
<div id="labels"><span>front / 正面</span><span>side / 横</span><span>back / 背面</span><span>table camera / 卓俯瞰</span></div>
<div id="sources"></div><canvas width="1440" height="560" aria-label="未承認4方向3Dモデル比較"></canvas><output id="status"></output>`;
const canvas = root.querySelector("canvas")!;
const gl = canvas.getContext("webgl2", {
  antialias: true,
  preserveDrawingBuffer: true,
  alpha: false,
});
if (!gl) throw new Error("WebGL2 unavailable");
const gpu = gl;
const shaders: WebGLShader[] = [],
  buffers: WebGLBuffer[] = [],
  vaos: WebGLVertexArrayObject[] = [],
  textures: WebGLTexture[] = [];
function shader(type: number, source: string) {
  const s = gpu.createShader(type)!;
  shaders.push(s);
  gpu.shaderSource(s, source);
  gpu.compileShader(s);
  if (!gpu.getShaderParameter(s, gpu.COMPILE_STATUS))
    throw new Error(gpu.getShaderInfoLog(s) ?? "shader compilation");
  return s;
}
const program = gpu.createProgram()!;
gpu.attachShader(program, shader(gpu.VERTEX_SHADER, VERTEX));
gpu.attachShader(program, shader(gpu.FRAGMENT_SHADER, FRAGMENT));
gpu.linkProgram(program);
if (!gpu.getProgramParameter(program, gpu.LINK_STATUS))
  throw new Error(gpu.getProgramInfoLog(program) ?? "link");
const uniforms = Object.fromEntries(
  ["camera", "color", "textured", "image"].map((name) => [
    name,
    gpu.getUniformLocation(program, name),
  ]),
);
const actors = new Map<
  CharacterPlayerId,
  {
    model: CharacterModel;
    texture: WebGLTexture;
    meshes: {
      vao: WebGLVertexArrayObject;
      buffer: WebGLBuffer;
      colorBuffer?: WebGLBuffer;
    }[];
  }
>();
let modelId: CharacterPlayerId = "p0",
  clipId: CharacterClipId = "standing-reference",
  time = 0,
  playing = false,
  reduced = false,
  disposed = false,
  raf = 0,
  previous = 0;
let generation = 0,
  draws = 0,
  pendingState = false;
const actorSelect = root.querySelector<HTMLSelectElement>("#actor")!,
  clipSelect = root.querySelector<HTMLSelectElement>("#clip")!,
  status = root.querySelector<HTMLOutputElement>("#status")!;
function updateSource(model: CharacterModel) {
  const columns = [0, 420, 775, 0],
    source = root.querySelector<HTMLElement>("#sources")!;
  source.replaceChildren(
    ...columns.map((column, index) => {
      const box = document.createElement("div"),
        crop = document.createElement("div"),
        img = new Image();
      box.className = "source";
      crop.className = "crop";
      img.src = `/${model.source.path}`;
      img.alt = `${model.name} 原本 ${["正面", "横", "背面", "正面（姿勢比較）"][index]}`;
      img.style.left = `${-column * 0.31}px`;
      crop.append(img);
      box.append(crop);
      return box;
    }),
  );
}
const propVao = gpu.createVertexArray()!,
  propBuffer = gpu.createBuffer()!;
vaos.push(propVao);
buffers.push(propBuffer);
gpu.bindVertexArray(propVao);
gpu.bindBuffer(gpu.ARRAY_BUFFER, propBuffer);
for (const [location, size, offset] of [
  [0, 3, 0],
  [1, 3, 12],
  [2, 2, 24],
]) {
  gpu.enableVertexAttribArray(location);
  gpu.vertexAttribPointer(location, size, gpu.FLOAT, false, 32, offset);
}
function reviewBox(center: V3, size: V3, color: V3) {
  const vertices: number[] = [];
  for (let axis = 0; axis < 3; axis++)
    for (const sign of [-1, 1]) {
      const a = (axis + 1) % 3,
        b = (axis + 2) % 3,
        points = [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ].map(([x, y]) => {
          const v = [...center];
          v[axis] += (sign * size[axis]) / 2;
          v[a] += (x * size[a]) / 2;
          v[b] += (y * size[b]) / 2;
          return v;
        });
      for (const i of [0, 1, 2, 0, 2, 3]) {
        const n = [0, 0, 0];
        n[axis] = sign;
        vertices.push(...points[i], ...n, 0, 0);
      }
    }
  gpu.bindVertexArray(propVao);
  gpu.disableVertexAttribArray(3);
  gpu.vertexAttrib3f(3, 1, 1, 1);
  gpu.bindBuffer(gpu.ARRAY_BUFFER, propBuffer);
  gpu.bufferData(
    gpu.ARRAY_BUFFER,
    new Float32Array(vertices),
    gpu.DYNAMIC_DRAW,
  );
  gpu.uniform3fv(uniforms.color, color);
  gpu.uniform1i(uniforms.textured, 0);
  gpu.drawArrays(gpu.TRIANGLES, 0, vertices.length / 8);
}
async function load(id: CharacterPlayerId) {
  if (disposed) return;
  if (actors.has(id)) return actors.get(id)!;
  const model = createCharacterModel(id),
    texture = gpu.createTexture()!;
  textures.push(texture);
  const image = new Image();
  image.src = `/${model.materials.find((m) => m.texture)!.texture}`;
  await image.decode();
  if (disposed) return;
  gpu.bindTexture(gpu.TEXTURE_2D, texture);
  gpu.pixelStorei(gpu.UNPACK_FLIP_Y_WEBGL, false);
  gpu.texImage2D(gpu.TEXTURE_2D, 0, gpu.RGB, gpu.RGB, gpu.UNSIGNED_BYTE, image);
  gpu.texParameteri(gpu.TEXTURE_2D, gpu.TEXTURE_MIN_FILTER, gpu.LINEAR);
  gpu.texParameteri(gpu.TEXTURE_2D, gpu.TEXTURE_MAG_FILTER, gpu.LINEAR);
  gpu.texParameteri(gpu.TEXTURE_2D, gpu.TEXTURE_WRAP_S, gpu.CLAMP_TO_EDGE);
  gpu.texParameteri(gpu.TEXTURE_2D, gpu.TEXTURE_WRAP_T, gpu.CLAMP_TO_EDGE);
  const meshes = model.meshes.map((mesh) => {
    const vao = gpu.createVertexArray()!,
      buffer = gpu.createBuffer()!;
    vaos.push(vao);
    buffers.push(buffer);
    gpu.bindVertexArray(vao);
    gpu.bindBuffer(gpu.ARRAY_BUFFER, buffer);
    gpu.bufferData(
      gpu.ARRAY_BUFFER,
      mesh.vertices.byteLength,
      gpu.DYNAMIC_DRAW,
    );
    for (const [location, size, offset] of [
      [0, 3, 0],
      [1, 3, 12],
      [2, 2, 24],
    ]) {
      gpu.enableVertexAttribArray(location);
      gpu.vertexAttribPointer(location, size, gpu.FLOAT, false, 32, offset);
    }
    let colorBuffer: WebGLBuffer | undefined;
    if (mesh.colors) {
      colorBuffer = gpu.createBuffer()!;
      buffers.push(colorBuffer);
      gpu.bindBuffer(gpu.ARRAY_BUFFER, colorBuffer);
      gpu.bufferData(gpu.ARRAY_BUFFER, mesh.colors, gpu.STATIC_DRAW);
      gpu.enableVertexAttribArray(3);
      gpu.vertexAttribPointer(3, 3, gpu.FLOAT, false, 12, 0);
    }
    return { vao, buffer, colorBuffer };
  });
  const actor = { model, texture, meshes };
  actors.set(id, actor);
  return actor;
}
function draw() {
  if (disposed) return;
  const actor = actors.get(modelId);
  if (!actor) return;
  gpu.enable(gpu.DEPTH_TEST);
  gpu.enable(gpu.SCISSOR_TEST);
  gpu.disable(gpu.CULL_FACE);
  gpu.useProgram(program);
  gpu.activeTexture(gpu.TEXTURE0);
  gpu.uniform1i(uniforms.image, 0);
  gpu.bindTexture(gpu.TEXTURE_2D, actor.texture);
  const standing = sampleCharacterPose(actor.model, "standing-reference", 0),
    pose = sampleCharacterPose(actor.model, clipId, time, reduced),
    h = actor.model.height;
  for (let j = 0; j < 4; j++) {
    const view: View = (["front", "side", "back", "table"] as const)[j],
      w = 360,
      hh = 560;
    gpu.viewport(j * w, 0, w, hh);
    gpu.scissor(j * w, 0, w, hh);
    gpu.clearColor(0.89, 0.91, 0.92, 1);
    gpu.clear(gpu.COLOR_BUFFER_BIT | gpu.DEPTH_BUFFER_BIT);
    const a = view === "table" ? pose : standing;
    const target: V3 = view === "table" ? [0, 0.76, 0.16] : [0, h / 2, 0];
    const eye: V3 =
      view === "side"
        ? [4, h / 2, 0]
        : view === "back"
          ? [0, h / 2, -4]
          : view === "table"
            ? [1.9, 2.7, 3.6]
            : [0, h / 2, 4];
    gpu.uniformMatrix4fv(
      uniforms.camera,
      false,
      camera(eye, target, w / hh, view === "table" ? 1.8 : h + 0.1),
    );
    if (view === "table") {
      // Context only: isolated metre-scale table edge and seat, not the main
      // gameplay table renderer or an integration acceptance claim.
      reviewBox([0, 0.47, -0.015], [0.43, 0.045, 0.42], [0.055, 0.065, 0.068]);
      reviewBox([0, 0.745, 0.78], [1.1, 0.055, 0.78], [0.025, 0.22, 0.115]);
      reviewBox([0, 0.715, 0.385], [1.13, 0.1, 0.045], [0.04, 0.045, 0.043]);
    }
    const batches = projectCharacterGeometry(actor.model, a);
    for (let k = 0; k < batches.length; k++) {
      const batch = batches[k],
        mat = actor.model.materials.find((m) => m.id === batch.materialId)!,
        mesh = actor.meshes[k];
      gpu.bindVertexArray(mesh.vao);
      if (!mesh.colorBuffer) {
        gpu.disableVertexAttribArray(3);
        gpu.vertexAttrib3f(3, 1, 1, 1);
      }
      gpu.bindBuffer(gpu.ARRAY_BUFFER, mesh.buffer);
      gpu.bufferSubData(gpu.ARRAY_BUFFER, 0, batch.vertices);
      gpu.uniform3fv(uniforms.color, mat.color);
      gpu.uniform1i(uniforms.textured, mat.texture ? 1 : 0);
      gpu.drawArrays(gpu.TRIANGLES, 0, batch.vertices.length / 8);
    }
  }
  gpu.disable(gpu.SCISSOR_TEST);
  gpu.bindVertexArray(null);
  gpu.bindBuffer(gpu.ARRAY_BUFFER, null);
  const error = gpu.getError();
  if (error !== gpu.NO_ERROR) throw new Error(`WebGL error: ${error}`);
  draws++;
  status.textContent = `${actor.model.name} / ${actor.model.id} | WebGL2 | ${clipId} ${time.toFixed(2)}s | 未承認候補`;
}
async function setState(
  id: CharacterPlayerId,
  clip: CharacterClipId,
  t = 0,
  r = false,
) {
  const token = ++generation;
  pendingState = true;
  try {
    await load(id);
    if (disposed || token !== generation) return;
    modelId = id;
    clipId = clip;
    time = t;
    reduced = r;
    actorSelect.value = id;
    clipSelect.value = clip;
    updateSource(actors.get(id)!.model);
    draw();
  } finally {
    if (token === generation) pendingState = false;
  }
}
function animate(now: number) {
  if (disposed || !playing) return;
  if (previous) time += (now - previous) / 1000;
  previous = now;
  draw();
  raf = requestAnimationFrame(animate);
}
const onActor = () =>
  void setState(actorSelect.value as CharacterPlayerId, clipId, time, reduced);
const onClip = () => {
  clipId = clipSelect.value as CharacterClipId;
  time = 0;
  draw();
};
const onPlay = () => {
  playing = !playing;
  root.querySelector("#play")!.textContent = playing ? "停止" : "再生";
  previous = 0;
  if (playing) raf = requestAnimationFrame(animate);
  else cancelAnimationFrame(raf);
};
const onRestart = () => {
  time = 0;
  draw();
};
const onReduced = () => {
  reduced = root.querySelector<HTMLInputElement>("#reduced")!.checked;
  draw();
};
actorSelect.addEventListener("change", onActor);
clipSelect.addEventListener("change", onClip);
root.querySelector("#play")!.addEventListener("click", onPlay);
root.querySelector("#restart")!.addEventListener("click", onRestart);
root.querySelector("#reduced")!.addEventListener("change", onReduced);
function dispose() {
  if (disposed) return;
  disposed = true;
  generation++;
  playing = false;
  pendingState = false;
  cancelAnimationFrame(raf);
  actorSelect.removeEventListener("change", onActor);
  clipSelect.removeEventListener("change", onClip);
  root.querySelector("#play")!.removeEventListener("click", onPlay);
  root.querySelector("#restart")!.removeEventListener("click", onRestart);
  root.querySelector("#reduced")!.removeEventListener("change", onReduced);
  for (const b of buffers) gpu.deleteBuffer(b);
  for (const v of vaos) gpu.deleteVertexArray(v);
  for (const t of textures) gpu.deleteTexture(t);
  for (const s of shaders) gpu.deleteShader(s);
  gpu.deleteProgram(program);
  actors.clear();
}
declare global {
  interface Window {
    characterReview: {
      setState: typeof setState;
      telemetry: typeof telemetry;
      dispose: typeof dispose;
      ready: Promise<void>;
    };
  }
}
function telemetry() {
  return {
    modelId,
    clipId,
    time,
    draws,
    playing,
    pendingState,
    disposed,
    contexts: 1,
    renderer: gpu.getParameter(gpu.RENDERER),
    version: gpu.getParameter(gpu.VERSION),
    finished:
      !CHARACTER_CLIPS[clipId].loop && time >= CHARACTER_CLIPS[clipId].duration,
    triangles: actors
      .get(modelId)
      ?.model.meshes.reduce((sum, m) => sum + m.vertices.length / 24, 0),
  };
}
window.characterReview = {
  setState,
  dispose,
  telemetry,
  ready: setState("p0", "standing-reference"),
};
window.addEventListener("pagehide", dispose, { once: true });
