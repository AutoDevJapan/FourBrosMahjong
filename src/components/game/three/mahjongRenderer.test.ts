// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DisplayEnvelope } from "@/domain/display/displaySnapshot";
import { createMahjongRenderer } from "./mahjongRenderer";
import { projectScene, TILE_TEXTURE_URLS } from "./scene";
import { frame } from "./sceneFixture";

// Lifetime/error tests use a driver double; real shader, pixels and picking
// must additionally be checked in a browser with an actual WebGL2 context.
function driver() {
  let next = 0;
  const gl = {
    createShader: vi.fn(() => ({ id: ++next })),
    createProgram: vi.fn(() => ({ id: ++next })),
    createBuffer: vi.fn(() => ({ id: ++next })),
    createVertexArray: vi.fn(() => ({ id: ++next })),
    createTexture: vi.fn(() => ({ id: ++next })),
    getShaderParameter: vi.fn(() => true),
    getProgramParameter: vi.fn(() => true),
    getUniformLocation: vi.fn(() => ({ id: ++next })),
    getParameter: vi.fn(() => 4096),
    getError: vi.fn(() => 0),
    isContextLost: vi.fn(() => false),
    drawArrays: vi.fn(),
    texImage2D: vi.fn(),
    deleteBuffer: vi.fn(),
    deleteVertexArray: vi.fn(),
    deleteShader: vi.fn(),
    deleteTexture: vi.fn(),
    deleteProgram: vi.fn(),
  };
  return new Proxy(gl, {
    get(target, key) {
      if (key in target) return target[key as keyof typeof target];
      if (key === "NO_ERROR") return 0;
      if (typeof key === "string" && key === key.toUpperCase()) return 1;
      return vi.fn();
    },
  });
}

function setup(gl: ReturnType<typeof driver> | null) {
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "getContext").mockReturnValue(
    gl as unknown as WebGL2RenderingContext,
  );
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 960,
    height: 640,
    right: 960,
    bottom: 640,
    toJSON() {},
  });
  const raster = {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    fillStyle: "",
  };
  const originalCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((name: string) => {
    const node = originalCreate(name);
    if (name === "canvas")
      vi.spyOn(node as HTMLCanvasElement, "getContext").mockReturnValue(
        raster as unknown as CanvasRenderingContext2D,
      );
    return node;
  });
  return canvas;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function controlledImages() {
  const images: HTMLImageElement[] = [];
  const OriginalImage = window.Image;
  vi.stubGlobal(
    "Image",
    class {
      constructor() {
        const image = new OriginalImage();
        Object.defineProperty(image, "naturalWidth", { value: 300 });
        Object.defineProperty(image, "naturalHeight", { value: 400 });
        images.push(image);
        return image;
      }
    },
  );
  return images;
}

describe("WebGL2 renderer boundaries", () => {
  it("announces ready only after all textures, a public frame and successful nonzero drawing", () => {
    const gl = driver(),
      canvas = setup(gl),
      images = controlledImages();
    const onError = vi.fn(),
      onReady = vi.fn(),
      onPick = vi.fn();
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const renderer = createMahjongRenderer(canvas, {
      onError,
      onReady,
      onPick,
    });
    expect(images).toHaveLength(TILE_TEXTURE_URLS.length);
    renderer.publish(frame());
    for (const image of images.slice(0, -1))
      image.dispatchEvent(new Event("load"));
    expect(gl.drawArrays).not.toHaveBeenCalled();
    expect(onReady).not.toHaveBeenCalled();
    images.at(-1)!.dispatchEvent(new Event("load"));
    expect(gl.texImage2D).toHaveBeenCalledTimes(30);
    expect(gl.drawArrays).toHaveBeenCalled();
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    // No timer/RAF or same-revision publication keeps redrawing a static table.
    const firstDraws = gl.drawArrays.mock.calls.length;
    renderer.publish(frame());
    renderer.publish({ ...frame(), revision: 0, mode: "live" });
    expect(gl.drawArrays).toHaveBeenCalledTimes(firstDraws);
    expect(raf).not.toHaveBeenCalled();
    const own = projectScene(frame()).tiles.find(
      (tile) => tile.optionId === "red-first",
    )!;
    const p = renderer.projectPoint(own.center);
    expect(renderer.hitTest(p.x, p.y)).toMatchObject({
      optionId: "red-first",
      revision: 0,
    });
    canvas.dispatchEvent(
      new MouseEvent("click", { clientX: p.x, clientY: p.y }),
    );
    expect(onPick).toHaveBeenCalledWith("red-first");
    renderer.select("red-first");
    expect(gl.drawArrays.mock.calls.length).toBeGreaterThan(firstDraws);
    renderer.publish({ ...frame(), revision: 1, mode: "restore" });
    expect(onReady).toHaveBeenCalledTimes(1);
    renderer.setGroups(["table", "discards", "dora"]);
    expect(renderer.hitTest(p.x, p.y)).toBe(null);
    renderer.dispose();
    const lastDraws = gl.drawArrays.mock.calls.length;
    images[0].dispatchEvent(new Event("load"));
    renderer.resize();
    renderer.publish({ ...frame(), revision: 2 });
    expect(gl.drawArrays).toHaveBeenCalledTimes(lastDraws);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(30);
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(3);
    expect(gl.deleteVertexArray).toHaveBeenCalledTimes(3);
  });

  it("defers ready for hidden canvases and never signals it for a GPU draw error", () => {
    const gl = driver(),
      canvas = setup(gl),
      images = controlledImages();
    const onError = vi.fn(),
      onReady = vi.fn();
    const renderer = createMahjongRenderer(canvas, { onError, onReady });
    renderer.resize(0, 0);
    renderer.publish(frame());
    for (const image of images) image.dispatchEvent(new Event("load"));
    expect(onReady).not.toHaveBeenCalled();
    gl.getError.mockReturnValue(1282);
    renderer.resize(960, 640);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({ code: "draw" });
    expect(onReady).not.toHaveBeenCalled();
    renderer.dispose();
    expect(gl.deleteTexture).toHaveBeenCalledTimes(30);
  });

  it("times out stalled SVG loads once and cancels all outstanding callbacks", () => {
    vi.useFakeTimers();
    const gl = driver(),
      canvas = setup(gl),
      images = controlledImages(),
      onError = vi.fn(),
      onReady = vi.fn();
    const renderer = createMahjongRenderer(canvas, { onError, onReady });
    renderer.publish(frame());
    vi.advanceTimersByTime(15000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({ code: "texture" });
    expect(
      images.every((image) => image.onload === null && image.onerror === null),
    ).toBe(true);
    expect(onReady).not.toHaveBeenCalled();
    renderer.dispose();
  });

  it("reports unsupported WebGL2 once and remains safely disposable", () => {
    const canvas = setup(null),
      onError = vi.fn(),
      onReady = vi.fn();
    const renderer = createMahjongRenderer(canvas, { onError, onReady });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({ code: "unsupported" });
    renderer.resize();
    renderer.dispose();
    renderer.dispose();
    expect(onReady).not.toHaveBeenCalled();
  });

  it("frees allocated shaders on compile failure before returning a failed renderer", () => {
    const gl = driver();
    gl.getShaderParameter.mockReturnValue(false);
    const onError = vi.fn(),
      renderer = createMahjongRenderer(setup(gl), { onError });
    expect(onError.mock.calls[0][0]).toMatchObject({ code: "initialization" });
    expect(gl.deleteShader.mock.calls.length).toBe(
      gl.createShader.mock.calls.length,
    );
    renderer.dispose();
    expect(gl.deleteShader.mock.calls.length).toBe(
      gl.createShader.mock.calls.length,
    );
  });

  it("reports texture failure and releases all GPU resources/listeners without ready", () => {
    const gl = driver(),
      canvas = setup(gl),
      onError = vi.fn(),
      onReady = vi.fn();
    const remove = vi.spyOn(canvas, "removeEventListener");
    const images: HTMLImageElement[] = [];
    const OriginalImage = window.Image;
    vi.stubGlobal(
      "Image",
      class {
        constructor() {
          const img = new OriginalImage();
          images.push(img);
          return img;
        }
      },
    );
    const renderer = createMahjongRenderer(canvas, { onError, onReady });
    expect(images.length).toBeGreaterThan(0);
    images[0].dispatchEvent(new Event("error"));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({ code: "texture" });
    renderer.dispose();
    renderer.dispose();
    expect(gl.deleteBuffer.mock.calls.length).toBe(
      gl.createBuffer.mock.calls.length,
    );
    expect(gl.deleteTexture.mock.calls.length).toBe(
      gl.createTexture.mock.calls.length,
    );
    expect(gl.deleteProgram.mock.calls.length).toBe(
      gl.createProgram.mock.calls.length,
    );
    expect(gl.deleteShader.mock.calls.length).toBe(
      gl.createShader.mock.calls.length,
    );
    expect(gl.deleteVertexArray.mock.calls.length).toBe(
      gl.createVertexArray.mock.calls.length,
    );
    expect(remove.mock.calls.map(([name]) => name)).toEqual(
      expect.arrayContaining([
        "click",
        "webglcontextlost",
        "webglcontextcreationerror",
      ]),
    );
    expect(onReady).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("closes on context loss, cancels loading and never silently recreates a context", () => {
    const gl = driver(),
      canvas = setup(gl),
      onError = vi.fn(),
      onReady = vi.fn();
    const renderer = createMahjongRenderer(canvas, { onError, onReady });
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    renderer.resize();
    renderer.select("old-option");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatchObject({ code: "context-lost" });
    expect(canvas.getContext).toHaveBeenCalledTimes(1);
    expect(renderer.hitTest(500, 500)).toBe(null);
    renderer.dispose();
    expect(onReady).not.toHaveBeenCalled();
  });

  it("rejects a malformed frame before uploading or allocating scene resources", () => {
    const gl = driver(),
      onError = vi.fn(),
      renderer = createMahjongRenderer(setup(gl), { onError });
    renderer.publish({
      protocol: "wrong",
      version: 1,
    } as unknown as DisplayEnvelope);
    expect(onError.mock.calls[0][0]).toMatchObject({ code: "frame" });
    renderer.dispose();
    expect(gl.deleteBuffer.mock.calls.length).toBe(
      gl.createBuffer.mock.calls.length,
    );
  });
});
