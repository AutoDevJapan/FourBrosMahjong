import type { DisplayEnvelope } from "@/domain/display/displaySnapshot";
import {
  CHARACTER_METRES_TO_SCENE,
  type CharacterSurface,
  characterPlacement,
} from "./characterScene";
import { beveledBox, FACE_VERTICES } from "./geometry";
import {
  camera,
  insideTriangle,
  localPoint,
  type Matrix4,
  type ProjectedPoint,
  project,
  transform,
} from "./math";
import {
  type MahjongScene,
  projectScene,
  SCENE_GROUPS,
  type SceneGroup,
  type SceneTile,
  TILE_TEXTURE_URLS,
  type Vec3,
} from "./scene";

export interface MahjongRendererOptions {
  readonly onError: (error: unknown) => void;
  readonly onReady?: () => void;
  readonly onPick?: (optionId: string) => void;
  readonly groups?: readonly SceneGroup[];
  /** Exact hashed runtime URLs, supplied only by an approved character host. */
  readonly characterTextures?: Readonly<Record<string, string>>;
}
interface MahjongPick {
  readonly sessionId: string;
  readonly revision: number;
  readonly optionId: string;
  readonly optionIds: readonly string[];
  readonly tileId: string;
}
export interface MahjongRenderer {
  publish(frame: DisplayEnvelope): void;
  /** No args: use canvas CSS rect/DPR. Explicit values are also CSS pixels. */
  resize(width?: number, height?: number, dpr?: number): void;
  dispose(): void;
  select(optionId: string | null): void;
  setSelected(optionId: string | null): void;
  setGroups(groups: readonly SceneGroup[]): void;
  hitTest(x: number, y: number): MahjongPick | null;
  projectPoint(point: Vec3): ProjectedPoint;
  setCharacters(surfaces: readonly CharacterSurface[]): void;
}

class MahjongRendererError extends Error {
  constructor(
    readonly code:
      | "unsupported"
      | "initialization"
      | "texture"
      | "context-lost"
      | "frame"
      | "draw",
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "MahjongRendererError";
  }
}

const VERTEX = `#version 300 es
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUv;
uniform mat4 uModel;
uniform mat4 uCamera;
out vec3 vNormal;
out vec3 vWorld;
out vec3 vLocal;
out vec2 vUv;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorld = world.xyz;
  vLocal = aPosition;
  mat3 m = mat3(uModel);
  vNormal = normalize(m * (aNormal / vec3(dot(m[0],m[0]),dot(m[1],m[1]),dot(m[2],m[2]))));
  vUv = aUv;
  gl_Position = uCamera * world;
}`;
const FRAGMENT = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
in vec3 vLocal;
in vec2 vUv;
uniform vec3 uColor;
uniform int uMaterial;
uniform bool uTextured;
uniform bool uSelected;
uniform float uAlpha;
uniform sampler2D uTexture;
out vec4 outColor;
void main() {
  vec3 color = uColor;
  if (uTextured) color = texture(uTexture, vUv).rgb;
  if (uMaterial == 1) {
    float grain = fract(sin(dot(floor(vWorld.xz * 170.0), vec2(12.9898,78.233))) * 43758.5453);
    color *= 0.94 + grain * 0.12;
  }
  if (uMaterial == 2 && !uTextured && vLocal.y < -0.20) color = vec3(0.35,0.065,0.035);
  vec3 n = normalize(vNormal);
  float light = 0.64 + max(dot(n, normalize(vec3(-0.45,1.0,0.7))),0.0) * 0.43;
  float sheen = pow(max(dot(n, normalize(vec3(-0.25,1.0,0.35))),0.0),24.0) * 0.06;
  if (uSelected) color = mix(color, vec3(0.9,0.70,0.20), uTextured ? 0.10 : 0.42);
  outColor = vec4(color * light + sheen, uAlpha);
}`;

interface Mesh {
  readonly vao: WebGLVertexArrayObject;
  readonly count: number;
}
interface PickFace {
  readonly tile: SceneTile;
  readonly corners: readonly ProjectedPoint[];
  readonly depth: number;
}

/** Native WebGL2, one owned context, shared solid meshes, on-demand drawing. */
export function createMahjongRenderer(
  canvas: HTMLCanvasElement,
  options: MahjongRendererOptions,
): MahjongRenderer {
  let gl: WebGL2RenderingContext | null = null;
  let stopped = false,
    ready = false,
    texturesReady = false;
  let frame: DisplayEnvelope | null = null,
    scene: MahjongScene | null = null;
  let groups = [...(options.groups ?? SCENE_GROUPS)];
  let selected: string | null = null;
  let width = 0,
    height = 0,
    vp = camera(1.5);
  let picks: PickFace[] = [];
  let highestGeneration = 0;
  let characterSurfaces: readonly CharacterSurface[] = [];
  const characterMeshes = new Map<
    string,
    { mesh: Mesh; buffer: WebGLBuffer; vertices: number }
  >();
  const shaders: WebGLShader[] = [],
    programs: WebGLProgram[] = [],
    buffers: WebGLBuffer[] = [],
    vaos: WebGLVertexArrayObject[] = [];
  const textures = new Map<string, WebGLTexture>();
  const images: HTMLImageElement[] = [];
  let loadingTimer: ReturnType<typeof setTimeout> | undefined;
  let body: Mesh, cube: Mesh, face: Mesh;
  let program: WebGLProgram;
  let uniforms: Record<string, WebGLUniformLocation>;

  const cleanup = () => {
    if (loadingTimer !== undefined) clearTimeout(loadingTimer);
    loadingTimer = undefined;
    canvas.removeEventListener("click", click);
    canvas.removeEventListener("webglcontextlost", contextLost);
    canvas.removeEventListener(
      "webglcontextcreationerror",
      contextCreationError,
    );
    for (const img of images) {
      img.onload = null;
      img.onerror = null;
      img.removeAttribute("src");
    }
    images.length = 0;
    if (gl) {
      for (const item of textures.values()) gl.deleteTexture(item);
      for (const item of vaos) gl.deleteVertexArray(item);
      for (const item of buffers) gl.deleteBuffer(item);
      for (const item of programs) gl.deleteProgram(item);
      for (const item of shaders) gl.deleteShader(item);
    }
    textures.clear();
    vaos.length = 0;
    buffers.length = 0;
    programs.length = 0;
    shaders.length = 0;
    picks = [];
    scene = null;
    frame = null;
    selected = null;
    highestGeneration = 0;
    characterSurfaces = [];
    characterMeshes.clear();
  };
  const fail = (
    code: MahjongRendererError["code"],
    message: string,
    cause?: unknown,
  ) => {
    if (stopped) return;
    stopped = true;
    cleanup();
    options.onError(new MahjongRendererError(code, message, cause));
  };
  function contextLost(event: Event) {
    event.preventDefault();
    fail(
      "context-lost",
      "WebGL2 context was lost; remount to restore the latest snapshot",
    );
  }
  function contextCreationError() {
    fail("unsupported", "WebGL2 context creation failed");
  }
  function click(event: MouseEvent) {
    const bounds = canvas.getBoundingClientRect();
    const hit = hitTest(
      ((event.clientX - bounds.left) * width) / bounds.width,
      ((event.clientY - bounds.top) * height) / bounds.height,
    );
    if (hit) options.onPick?.(hit.optionId);
  }
  function hitTest(x: number, y: number): MahjongPick | null {
    if (
      stopped ||
      !ready ||
      !frame ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      y < 0 ||
      x > width ||
      y > height
    )
      return null;
    const hit = picks.find(
      ({ corners: c }) =>
        insideTriangle(x, y, c[0], c[1], c[2]) ||
        insideTriangle(x, y, c[0], c[2], c[3]),
    );
    if (!hit || !hit.tile.optionId) return null;
    return {
      sessionId: frame.sessionId,
      revision: frame.revision,
      optionId: hit.tile.optionId,
      optionIds: hit.tile.optionIds,
      tileId: hit.tile.id,
    };
  }
  const checked = () => {
    if (!gl || gl.isContextLost()) throw new Error("WebGL2 context is lost");
    const error = gl.getError();
    if (error !== gl.NO_ERROR)
      throw new Error(`WebGL2 error 0x${error.toString(16)}`);
  };
  const modelFor = (tile: SceneTile): Matrix4 => {
    const highlighted = selected !== null && tile.optionIds.includes(selected);
    return transform(
      [
        tile.center[0],
        tile.center[1] + (highlighted ? 0.36 : 0),
        tile.center[2],
      ],
      tile.rotation,
      tile.size,
    );
  };
  function draw() {
    if (stopped || !gl || !scene || !texturesReady || width <= 0 || height <= 0)
      return;
    try {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0.018, 0.026, 0.023, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(program);
      gl.uniformMatrix4fv(uniforms.uCamera, false, vp);
      gl.uniform1i(uniforms.uTexture, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1f(uniforms.uAlpha, 1);
      const mesh = (
        geometry: Mesh,
        model: Matrix4,
        color: Vec3,
        material: number,
        texture: WebGLTexture | undefined,
        highlight = false,
      ) => {
        gl!.bindVertexArray(geometry.vao);
        gl!.uniformMatrix4fv(uniforms.uModel, false, model);
        gl!.uniform3fv(uniforms.uColor, color);
        gl!.uniform1i(uniforms.uMaterial, material);
        gl!.uniform1i(uniforms.uSelected, highlight ? 1 : 0);
        gl!.uniform1i(uniforms.uTextured, texture ? 1 : 0);
        gl!.bindTexture(gl!.TEXTURE_2D, texture ?? null);
        gl!.drawArrays(gl!.TRIANGLES, 0, geometry.count);
      };
      for (const solid of scene.solids) {
        mesh(
          cube,
          transform(solid.center, [0, 0, 0], solid.size),
          solid.color,
          solid.material === "felt" ? 1 : 0,
          undefined,
        );
      }
      // A low transparent solid under each tile is a contact shadow on the felt.
      // It is geometry, independent of the approved illustration/reference image.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.uniform1f(uniforms.uAlpha, 0.2);
      for (const tile of scene.tiles) {
        mesh(
          cube,
          transform(
            [tile.center[0] + 0.07, 0.015, tile.center[2] + 0.08],
            [0, tile.rotation[1], 0],
            [tile.size[0] + 0.12, 0.012, tile.size[2] + 0.06],
          ),
          [0.005, 0.012, 0.008],
          0,
          undefined,
        );
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.uniform1f(uniforms.uAlpha, 1);
      for (const surface of characterSurfaces) {
        const item = characterMeshes.get(surface.id);
        if (!item) throw new Error("Character GPU binding is missing");
        const placement = characterPlacement(surface.position);
        const scale = CHARACTER_METRES_TO_SCENE;
        mesh(
          item.mesh,
          transform(
            placement.center,
            [0, placement.yaw, 0],
            [scale, scale, scale],
          ),
          surface.material.color,
          0,
          surface.material.texture
            ? textures.get(surface.material.texture)
            : undefined,
        );
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.uniform1f(uniforms.uAlpha, 1);
      const nextPicks: PickFace[] = [];
      for (const tile of scene.tiles) {
        const model = modelFor(tile);
        const highlight =
          selected !== null && tile.optionIds.includes(selected);
        mesh(body, model, [0.91, 0.89, 0.78], 2, undefined, highlight);
        mesh(
          face,
          model,
          [1, 1, 1],
          2,
          textures.get(tile.face ?? "/tiles/Back.svg"),
          highlight,
        );
        if (tile.optionId) {
          const corners = (
            [
              [-0.5, 0.51, -0.5],
              [0.5, 0.51, -0.5],
              [0.5, 0.51, 0.5],
              [-0.5, 0.51, 0.5],
            ] as const
          ).map((p) => project(vp, localPoint(model, p), width, height));
          if (corners.every((point) => point.visible))
            nextPicks.push({
              tile,
              corners,
              depth: corners.reduce((sum, p) => sum + p.depth, 0) / 4,
            });
        }
      }
      picks = nextPicks.sort((a, b) => a.depth - b.depth);
      gl.bindVertexArray(null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.useProgram(null);
      checked();
    } catch (error) {
      fail("draw", "WebGL2 table drawing failed", error);
      return;
    }
    if (!ready && !stopped) {
      ready = true;
      options.onReady?.();
    }
  }
  function resize(
    cssWidth?: number,
    cssHeight?: number,
    dpr = globalThis.devicePixelRatio || 1,
  ) {
    if (stopped || !gl) return;
    const rect = canvas.getBoundingClientRect();
    width = cssWidth ?? rect.width;
    height = cssHeight ?? rect.height;
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      width = 0;
      height = 0;
      picks = [];
      return;
    }
    // Bound backing storage, never the CSS layout or scene. Avoid giant DPR
    // buffers while retaining full scene/pick coordinates on high-DPI devices.
    const ratio = Number.isFinite(dpr) ? Math.max(0.5, Math.min(2, dpr)) : 1;
    const max = Math.min(
      4096,
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
    );
    const scale = Math.min(ratio, max / width, max / height);
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    vp = camera(width / height, options.characterTextures !== undefined);
    draw();
  }
  function select(optionId: string | null) {
    if (stopped) return;
    const next = scene?.tiles.some(
      (tile) => optionId !== null && tile.optionIds.includes(optionId),
    )
      ? optionId
      : null;
    if (next === selected) return;
    selected = next;
    draw();
  }
  const runtime: MahjongRenderer = {
    publish(value) {
      if (stopped) return;
      try {
        // Validate even a stale/malformed frame without allocating GPU objects.
        const next = projectScene(value, groups);
        if (
          value.generation < highestGeneration ||
          (value.generation === highestGeneration &&
            frame &&
            value.sessionId !== frame.sessionId) ||
          (frame?.sessionId === value.sessionId &&
            value.revision <= frame.revision)
        )
          return;
        highestGeneration = value.generation;
        frame = value;
        scene = next;
        selected = null;
      } catch (error) {
        fail("frame", "Invalid public display frame", error);
        return;
      }
      draw();
    },
    resize,
    dispose() {
      if (!stopped) {
        stopped = true;
        cleanup();
      }
    },
    select,
    setSelected: select,
    setGroups(value) {
      if (stopped) return;
      groups = [...value];
      if (frame) {
        scene = projectScene(frame, groups);
        selected = null;
        draw();
      }
    },
    hitTest,
    projectPoint(point) {
      return project(vp, point, width, height);
    },
    setCharacters(surfaces) {
      if (stopped || !gl) return;
      try {
        const ids = new Set(surfaces.map((surface) => surface.id));
        if (ids.size !== surfaces.length || surfaces.length > 64)
          throw new Error("Invalid character surface set");
        for (const surface of surfaces) {
          if (
            surface.vertices.length % 24 !== 0 ||
            surface.vertices.length > 12000 * 3 * 8 ||
            !surface.vertices.every(Number.isFinite)
          )
            throw new Error("Invalid character vertex stream");
          if (
            surface.material.texture &&
            !options.characterTextures?.[surface.material.texture]
          )
            throw new Error("Unregistered character texture");
          let item = characterMeshes.get(surface.id);
          if (!item) {
            const vao = gl.createVertexArray();
            if (!vao) throw new Error("Cannot allocate character geometry");
            vaos.push(vao);
            const buffer = gl.createBuffer();
            if (!buffer) throw new Error("Cannot allocate character geometry");
            buffers.push(buffer);
            gl.bindVertexArray(vao);
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            for (const [location, size, offset] of [
              [0, 3, 0],
              [1, 3, 12],
              [2, 2, 24],
            ]) {
              gl.enableVertexAttribArray(location);
              gl.vertexAttribPointer(
                location,
                size,
                gl.FLOAT,
                false,
                32,
                offset,
              );
            }
            item = {
              mesh: { vao, count: surface.vertices.length / 8 },
              buffer,
              vertices: surface.vertices.length,
            };
            characterMeshes.set(surface.id, item);
          }
          if (item.vertices !== surface.vertices.length)
            throw new Error("Character topology changed inside one runtime");
          gl.bindBuffer(gl.ARRAY_BUFFER, item.buffer);
          gl.bufferData(gl.ARRAY_BUFFER, surface.vertices, gl.DYNAMIC_DRAW);
        }
        for (const [id, item] of characterMeshes) {
          if (ids.has(id)) continue;
          gl.deleteVertexArray(item.mesh.vao);
          gl.deleteBuffer(item.buffer);
          vaos.splice(vaos.indexOf(item.mesh.vao), 1);
          buffers.splice(buffers.indexOf(item.buffer), 1);
          characterMeshes.delete(id);
        }
        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        characterSurfaces = surfaces;
        checked();
        draw();
      } catch (error) {
        fail("draw", "Character geometry update failed", error);
      }
    },
  };
  canvas.addEventListener("webglcontextlost", contextLost);
  canvas.addEventListener("webglcontextcreationerror", contextCreationError);
  canvas.addEventListener("click", click);
  try {
    gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: true,
      depth: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (stopped) return runtime;
    if (!gl) {
      fail("unsupported", "WebGL2 is unavailable");
      return runtime;
    }
    const shader = (type: number, source: string) => {
      const result = gl!.createShader(type);
      if (!result) throw new Error("Cannot allocate shader");
      shaders.push(result);
      gl!.shaderSource(result, source);
      gl!.compileShader(result);
      if (!gl!.getShaderParameter(result, gl!.COMPILE_STATUS))
        throw new Error(
          gl!.getShaderInfoLog(result) || "Shader compilation failed",
        );
      return result;
    };
    const vertex = shader(gl.VERTEX_SHADER, VERTEX),
      fragment = shader(gl.FRAGMENT_SHADER, FRAGMENT);
    const allocated = gl.createProgram();
    if (!allocated) throw new Error("Cannot allocate shader program");
    program = allocated;
    programs.push(program);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) || "Shader link failed");
    uniforms = {};
    for (const name of [
      "uModel",
      "uCamera",
      "uColor",
      "uMaterial",
      "uTextured",
      "uSelected",
      "uTexture",
      "uAlpha",
    ]) {
      const location = gl.getUniformLocation(program, name);
      if (location === null) throw new Error(`Missing shader uniform ${name}`);
      uniforms[name] = location;
    }
    const mesh = (vertices: Float32Array): Mesh => {
      const vao = gl!.createVertexArray();
      if (!vao) throw new Error("Cannot allocate vertex array");
      vaos.push(vao);
      gl!.bindVertexArray(vao);
      const buffer = gl!.createBuffer();
      if (!buffer) throw new Error("Cannot allocate vertex buffer");
      buffers.push(buffer);
      gl!.bindBuffer(gl!.ARRAY_BUFFER, buffer);
      gl!.bufferData(gl!.ARRAY_BUFFER, vertices, gl!.STATIC_DRAW);
      for (const [location, size, offset] of [
        [0, 3, 0],
        [1, 3, 12],
        [2, 2, 24],
      ]) {
        gl!.enableVertexAttribArray(location);
        gl!.vertexAttribPointer(location, size, gl!.FLOAT, false, 32, offset);
      }
      return { vao, count: vertices.length / 8 };
    };
    body = mesh(beveledBox());
    cube = mesh(beveledBox(0));
    face = mesh(FACE_VERTICES);
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    for (const url of [
      ...TILE_TEXTURE_URLS,
      ...Object.keys(options.characterTextures ?? {}),
    ]) {
      const texture = gl.createTexture();
      if (!texture) throw new Error("Cannot allocate tile texture");
      textures.set(url, texture);
    }
    checked();
    resize();
  } catch (error) {
    fail("initialization", "WebGL2 renderer initialization failed", error);
    return runtime;
  }

  // Rasterize only the existing bundled CC0 SVGs into owned GPU textures.
  // The reference game.png is never loaded, drawn, or used as a stand-in.
  try {
    const raster = document.createElement("canvas");
    raster.width = 192;
    raster.height = 256;
    const context = raster.getContext("2d");
    if (!context) throw new Error("Tile texture rasterization is unavailable");
    const imageInputs = [
      ...TILE_TEXTURE_URLS.map((url) => ({ key: url, url })),
      ...Object.entries(options.characterTextures ?? {}).map(([key, url]) => ({
        key,
        url,
      })),
    ];
    let remaining = imageInputs.length;
    loadingTimer = setTimeout(
      () => fail("texture", "Bundled tile textures timed out"),
      15000,
    );
    for (const { key, url } of imageInputs) {
      const img = new Image();
      images.push(img);
      img.onload = () => {
        if (stopped || !gl) return;
        try {
          if (img.naturalWidth <= 0 || img.naturalHeight <= 0)
            throw new Error("Empty tile image");
          const characterTexture = Object.hasOwn(
            options.characterTextures ?? {},
            key,
          );
          raster.width = characterTexture
            ? Math.min(2048, img.naturalWidth)
            : 192;
          raster.height = characterTexture
            ? Math.min(2048, img.naturalHeight)
            : 256;
          context.clearRect(0, 0, raster.width, raster.height);
          context.fillStyle = characterTexture
            ? "#181a18"
            : url.endsWith("/Back.svg")
              ? "#842c1b"
              : "#f9f7e9";
          context.fillRect(0, 0, raster.width, raster.height);
          context.drawImage(img, 0, 0, raster.width, raster.height);
          gl.bindTexture(gl.TEXTURE_2D, textures.get(key)!);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            raster,
          );
          gl.texParameteri(
            gl.TEXTURE_2D,
            gl.TEXTURE_MIN_FILTER,
            gl.LINEAR_MIPMAP_LINEAR,
          );
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.generateMipmap(gl.TEXTURE_2D);
          checked();
          remaining--;
          if (remaining === 0) {
            clearTimeout(loadingTimer);
            loadingTimer = undefined;
            for (const image of images) {
              image.onload = null;
              image.onerror = null;
              image.removeAttribute("src");
            }
            images.length = 0;
            texturesReady = true;
            draw();
          }
        } catch (error) {
          fail("texture", `Cannot upload bundled tile texture ${url}`, error);
        }
      };
      img.onerror = () =>
        fail("texture", `Cannot load bundled tile texture ${url}`);
      img.src = url;
    }
  } catch (error) {
    fail("texture", "Cannot prepare bundled tile textures", error);
  }
  return runtime;
}
