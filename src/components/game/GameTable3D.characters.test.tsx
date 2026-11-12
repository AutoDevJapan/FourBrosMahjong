import { act, render } from "@testing-library/react";
import { useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DisplayEnvelope } from "@/domain/display/displaySnapshot";
import type { CharacterActorFrame } from "./characters3d/controller";
import { type GameContextValue, GameProvider, useGame } from "./GameProvider";
import GameTable3D from "./GameTable3D";
import type { CharacterSurface } from "./three/characterScene";

// Keep the actual provider, adapter, character controller, models and skinning.
// This boundary double observes what reaches the GPU API; it does not attest GL.
const observed = vi.hoisted(() => ({
  samples: [] as CharacterActorFrame[][],
  renderers: [] as {
    frames: DisplayEnvelope[];
    surfaces: readonly (readonly CharacterSurface[])[];
    dispose: ReturnType<typeof vi.fn>;
  }[],
}));

vi.mock("./characters3d", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./characters3d")>();
  return {
    ...actual,
    createCharacterController: () => {
      const controller = actual.createCharacterController();
      return {
        ...controller,
        sample: (...args: Parameters<typeof controller.sample>) => {
          const actors = controller.sample(...args);
          observed.samples.push([...actors]);
          return actors;
        },
      };
    },
  };
});

vi.mock("./three/mahjongRenderer", () => ({
  createMahjongRenderer: vi.fn((_canvas, options) => {
    const surfaces: (readonly CharacterSurface[])[] = [];
    const renderer = {
      frames: [] as DisplayEnvelope[],
      surfaces,
      dispose: vi.fn(),
    };
    observed.renderers.push(renderer);
    return {
      publish: (frame: DisplayEnvelope) => {
        renderer.frames.push(frame);
        options.onReady?.();
      },
      setCharacters: (next: readonly CharacterSurface[]) => surfaces.push(next),
      resize: vi.fn(),
      select: vi.fn(),
      dispose: renderer.dispose,
    };
  }),
}));

let latest: GameContextValue;
function Probe() {
  const game = useGame();
  useLayoutEffect(() => {
    latest = game;
  });
  return null;
}

describe("real character pipeline through the live table host", () => {
  it("skins committed kita/draw reactions, returns to idle, and suppresses journal replay", () => {
    observed.samples = [];
    observed.renderers = [];
    window.sessionStorage.clear();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/game?seed=1");
    let clock = 0;
    let nextRequest = 1;
    const callbacks = new Map<number, FrameRequestCallback>();
    const originalMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    });
    vi.spyOn(performance, "now").mockImplementation(() => clock * 1000);
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = nextRequest++;
      callbacks.set(id, callback);
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      callbacks.delete(id);
    });
    const sampleAt = (seconds: number) => {
      clock = seconds;
      const batch = [...callbacks];
      callbacks.clear();
      act(() => {
        for (const [, callback] of batch) callback(seconds * 1000);
      });
    };
    const tree = () => (
      <GameProvider>
        <GameTable3D renderCharacters />
        <Probe />
      </GameProvider>
    );
    let ui: ReturnType<typeof render> | undefined;
    try {
      ui = render(tree());
      const renderer = observed.renderers[0];
      expect(observed.renderers).toHaveLength(1);
      expect(renderer.frames[0].mode).toBe("restore");
      expect(renderer.frames[0].cues).toEqual([]);
      const idle = observed.samples.at(-1)!;
      expect(idle.map((actor) => actor.playerId).sort()).toEqual([
        "p0",
        "p1",
        "p2",
        "p3",
      ]);
      expect(idle.filter((actor) => actor.kind === "bench")).toHaveLength(1);
      expect(idle.every((actor) => actor.pose.clipId.endsWith("idle"))).toBe(
        true,
      );
      const baseline = renderer.surfaces.at(-1)!;
      expect(baseline.length).toBeGreaterThan(4);
      for (const actor of idle) {
        expect(actor.model.id).toBe(actor.playerId);
        const own = baseline.filter((surface) =>
          surface.id.startsWith(`${actor.playerId}/`),
        );
        expect(own.length).toBeGreaterThan(0);
        expect(
          own.every((surface) => surface.position === actor.position),
        ).toBe(true);
      }

      clock = 1;
      act(() => latest.controls.kita());
      const committed = renderer.frames.at(-1)!;
      expect(committed.cues?.map((cue) => [cue.actorId, cue.kind])).toEqual([
        ["p0", "kita"],
        ["p0", "draw"],
      ]);
      sampleAt(1.5);
      const moving = observed.samples.at(-1)!;
      expect(moving.find((actor) => actor.playerId === "p0")?.pose.clipId).toBe(
        "kita",
      );
      expect(
        moving.filter((actor) => !actor.pose.clipId.endsWith("idle")),
      ).toHaveLength(1);
      const moved = renderer.surfaces.at(-1)!;
      const before = baseline.find(
        (surface) => surface.id === "p0/surface-skin",
      );
      const after = moved.find((surface) => surface.id === before?.id);
      expect(before).toBeDefined();
      expect(after).toBeDefined();
      expect(after!.vertices.every(Number.isFinite)).toBe(true);
      expect(after!.vertices).not.toEqual(before!.vertices);
      sampleAt(2.4);
      expect(
        observed.samples.at(-1)?.find((actor) => actor.playerId === "p0")?.pose
          .clipId,
      ).toBe("draw");
      sampleAt(4);
      expect(
        observed.samples
          .at(-1)
          ?.every((actor) => actor.pose.clipId.endsWith("idle")),
      ).toBe(true);

      const publications = renderer.frames.length;
      ui.rerender(tree());
      act(() => latest.controls.nextRound()); // rejected while still playing
      expect(renderer.frames).toHaveLength(publications);
      expect(observed.renderers).toHaveLength(1);
      ui.unmount();
      expect(renderer.dispose).toHaveBeenCalledOnce();
      expect(callbacks.size).toBe(0);

      window.history.replaceState(null, "", "/game");
      ui = render(tree());
      const restored = observed.renderers[1];
      expect(restored.frames[0].mode).toBe("restore");
      expect(restored.frames[0].cues).toEqual([]);
      expect(restored.frames[0].generation).toBeGreaterThan(
        committed.generation,
      );
      sampleAt(4.5);
      expect(
        observed.samples
          .at(-1)
          ?.every((actor) => actor.pose.clipId.endsWith("idle")),
      ).toBe(true);
      expect(restored.surfaces.at(-1)?.length).toBe(baseline.length);
      ui.unmount();
      expect(restored.dispose).toHaveBeenCalledOnce();
      expect(callbacks.size).toBe(0);
    } finally {
      ui?.unmount();
      vi.restoreAllMocks();
      if (originalMedia)
        Object.defineProperty(window, "matchMedia", originalMedia);
      else Reflect.deleteProperty(window, "matchMedia");
      window.history.replaceState(null, "", "/");
    }
  });
});
