// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

vi.mock("./model", () => ({
  createCharacterModel: (id: string) => ({
    id,
    materials: [{ texture: "fixture.jpg" }],
    meshes: [{ vertices: new Float32Array(24) }],
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

it("does not allocate or retain actor geometry after disposal during decode", async () => {
  vi.resetModules();
  document.body.innerHTML = '<main id="review"></main>';
  const gl = new Proxy(
    {
      createShader: vi.fn(() => ({})),
      createProgram: vi.fn(() => ({})),
      createTexture: vi.fn(() => ({})),
      createBuffer: vi.fn(() => ({})),
      createVertexArray: vi.fn(() => ({})),
      deleteShader: vi.fn(),
      deleteProgram: vi.fn(),
      deleteTexture: vi.fn(),
      deleteBuffer: vi.fn(),
      deleteVertexArray: vi.fn(),
      getShaderParameter: vi.fn(() => true),
      getProgramParameter: vi.fn(() => true),
      getUniformLocation: vi.fn(() => ({})),
    },
    {
      get(target, key) {
        return key in target ? target[key as keyof typeof target] : vi.fn();
      },
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    gl as unknown as WebGL2RenderingContext,
  );
  let finishDecode!: () => void;
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      decode() {
        return new Promise<void>((resolve) => {
          finishDecode = resolve;
        });
      }
    },
  );
  await import("./review-viewer");
  expect(finishDecode).toBeDefined();
  window.characterReview.dispose();
  const buffers = gl.createBuffer.mock.calls.length,
    vaos = gl.createVertexArray.mock.calls.length;
  finishDecode();
  await window.characterReview.ready;
  expect(gl.createBuffer).toHaveBeenCalledTimes(buffers);
  expect(gl.createVertexArray).toHaveBeenCalledTimes(vaos);
  expect(gl.deleteTexture.mock.calls.length).toBe(
    gl.createTexture.mock.calls.length,
  );
  expect(gl.deleteBuffer.mock.calls.length).toBe(buffers);
  expect(gl.deleteVertexArray.mock.calls.length).toBe(vaos);
  expect(window.characterReview.telemetry()).toMatchObject({
    disposed: true,
    pendingState: false,
    draws: 0,
  });
  delete (window as unknown as { characterReview?: unknown }).characterReview;
});
