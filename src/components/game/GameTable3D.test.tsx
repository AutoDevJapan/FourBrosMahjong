import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DisplayEnvelope } from "@/domain/display/displaySnapshot";
import { GameProvider } from "./GameProvider";
import GameTable3D from "./GameTable3D";

const renderer = vi.hoisted(() => ({
  instances: [] as Array<{
    frames: DisplayEnvelope[];
    dispose: ReturnType<typeof vi.fn>;
    pick: (id: string) => void;
    fail: (error: unknown) => void;
  }>,
  failCreate: false,
}));

vi.mock("./three/mahjongRenderer", () => ({
  createMahjongRenderer: vi.fn((_canvas, options) => {
    if (renderer.failCreate) throw new Error("WebGL unavailable");
    const instance = {
      frames: [] as DisplayEnvelope[],
      dispose: vi.fn(),
      pick: options.onPick,
      fail: options.onError,
    };
    renderer.instances.push(instance);
    return {
      publish: (frame: DisplayEnvelope) => {
        instance.frames.push(frame);
        options.onReady?.();
      },
      resize: vi.fn(),
      dispose: instance.dispose,
      select: vi.fn(),
    };
  }),
}));

beforeEach(() => {
  renderer.instances = [];
  renderer.failCreate = false;
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/game?seed=1");
});

describe("live 3D display host", () => {
  it("publishes actual provider state, confirms once and disposes both StrictMode resources", async () => {
    const ui = render(
      <StrictMode>
        <GameProvider>
          <GameTable3D />
        </GameProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(renderer.instances).toHaveLength(2));
    expect(renderer.instances[0].dispose).toHaveBeenCalledOnce();
    const current = renderer.instances[1];
    const first = current.frames[0];
    expect(first.mode).toBe("restore");
    expect(
      first.snapshot.slots.filter((slot) => slot.kind === "bench"),
    ).toHaveLength(1);
    const option = first.snapshot.options.find(
      (candidate) => candidate.action === "discard",
    );
    expect(option).toBeDefined();
    act(() => current.pick(option!.id));
    const confirm = screen.getByRole("button", { name: /を打牌/ });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(current.frames.at(-1)!.revision).toBe(first.revision + 1),
    );
    // An old pick after the committed revision cannot repeat the old intent.
    act(() => current.pick("unknown-option"));
    expect(
      screen.queryByRole("button", { name: /を打牌/ }),
    ).not.toBeInTheDocument();
    ui.unmount();
    expect(current.dispose).toHaveBeenCalledOnce();
  });

  it("reports unsupported rendering without taking down the provider or retaining a live input", async () => {
    render(
      <GameProvider>
        <GameTable3D />
        <p>対局は継続できます</p>
      </GameProvider>,
    );
    const current = renderer.instances[0];
    act(() => current.fail(new Error("context lost")));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("2D"),
    );
    expect(screen.getByText("対局は継続できます")).toBeVisible();
    expect(current.dispose).toHaveBeenCalledOnce();
    const frames = current.frames.length;
    act(() => current.pick(current.frames[0].snapshot.options[0].id));
    expect(current.frames).toHaveLength(frames);
    expect(
      screen.queryByRole("button", { name: /を打牌/ }),
    ).not.toBeInTheDocument();
  });

  it("handles a renderer factory failure with an explicit 2D fallback", async () => {
    renderer.failCreate = true;
    render(
      <GameProvider>
        <GameTable3D />
      </GameProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("2D"),
    );
    expect(renderer.instances).toHaveLength(0);
  });
});
