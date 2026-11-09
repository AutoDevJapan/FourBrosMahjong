import { describe, expect, it, vi } from "vitest";
import { createGame } from "@/domain/game/engine";
import { selectView } from "@/domain/game/gameView";
import {
  connectDisplayPort,
  type DisplayContext,
  type DisplayIntent,
  type DisplayPort,
  type IntentReceipt,
} from "./displayPort";
import {
  DISPLAY_PROTOCOL,
  DISPLAY_PROTOCOL_VERSION,
  type DisplayEnvelope,
} from "./displaySnapshot";
import { advanceDisplaySource, newLocalDisplaySource } from "./displaySource";

class FakeDisplayPort implements DisplayPort {
  readonly frames: DisplayEnvelope[] = [];
  listener: ((value: unknown) => IntentReceipt) | null = null;
  disposed = 0;
  publish(envelope: DisplayEnvelope) {
    this.frames.push(envelope);
  }
  onIntent(listener: (value: unknown) => IntentReceipt) {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }
  dispose() {
    this.disposed += 1;
  }
  emit(value: unknown) {
    return this.listener?.(value);
  }
}

function setup() {
  const state = createGame({ seed: 1 });
  let committed = newLocalDisplaySource();
  const commit = () => {
    committed = advanceDisplaySource(committed);
  };
  let context: DisplayContext = {
    playerId: "p0",
    isHost: true,
    phase: state.phase,
    pending: state.pending,
    view: selectView(state),
    displaySource: committed,
    readDisplaySource: () => committed,
    controls: {
      discard: vi.fn(commit),
      riichi: vi.fn(),
      ankan: vi.fn(),
      kakan: vi.fn(),
      tsumogiri: vi.fn(),
      tsumo: vi.fn(),
      ron: vi.fn(),
      pon: vi.fn(),
      kan: vi.fn(),
      kita: vi.fn(),
      passRon: vi.fn(),
      nextRound: vi.fn(commit),
      newGame: vi.fn(),
    },
  };
  const port = new FakeDisplayPort();
  const binding = connectDisplayPort(port, () => context);
  let request = 0;
  const intent = (
    kind: DisplayIntent["kind"] = "select",
    overrides: Partial<DisplayIntent> = {},
  ): DisplayIntent => ({
    protocol: DISPLAY_PROTOCOL,
    version: DISPLAY_PROTOCOL_VERSION,
    kind,
    requestId: `request-${request++}`,
    sessionId: context.displaySource!.sessionId,
    revision: context.displaySource!.revision,
    optionId: port.frames
      .at(-1)!
      .snapshot.options.find((option) => option.action === "discard")!.id,
    ...overrides,
  });
  return {
    port,
    binding,
    intent,
    context: () => context,
    update: (patch: Partial<DisplayContext>) => {
      context = { ...context, ...patch };
    },
    sync: () => {
      context = { ...context, displaySource: committed };
    },
    advance: (publishToContext = true) => {
      committed = advanceDisplaySource(committed);
      if (publishToContext) context = { ...context, displaySource: committed };
    },
    newSession: () => {
      committed = newLocalDisplaySource();
      context = { ...context, displaySource: committed };
    },
  };
}

describe("fake display port contract (#1177)", () => {
  it("first frame restores, new revision is live, and same revision does not replay", () => {
    const test = setup();
    expect(test.binding.refresh()).toBe("published");
    expect(test.port.frames[0].mode).toBe("restore");
    expect(test.binding.refresh()).toBe("unchanged");
    test.advance();
    expect(test.binding.refresh()).toBe("published");
    expect(test.port.frames[1].mode).toBe("live");
    expect(test.port.frames).toHaveLength(2);
  });

  it("requires selection of the same option before one dispatch per committed revision", () => {
    const test = setup();
    test.binding.refresh();
    expect(test.port.emit(test.intent("confirm"))).toMatchObject({
      reason: "selection-required",
    });
    expect(test.port.emit(test.intent("action"))).toMatchObject({
      reason: "wrong-kind",
    });
    const selection = test.intent();
    expect(test.port.emit(selection)).toEqual({ status: "selected" });
    expect(test.port.emit(selection)).toMatchObject({ reason: "duplicate" });
    const confirm = test.intent("confirm");
    expect(test.port.emit(confirm)).toEqual({ status: "dispatched" });
    expect(test.context().controls.discard).toHaveBeenCalledOnce();
    expect(test.port.emit(confirm)).toMatchObject({ reason: "stale" });
    expect(test.port.emit(test.intent())).toMatchObject({ reason: "stale" });
    test.sync();
    test.binding.refresh();
    expect(test.port.emit(test.intent("confirm"))).toMatchObject({
      reason: "selection-required",
    });
    expect(test.port.emit(test.intent())).toEqual({ status: "selected" });
  });

  it("rejects a synchronous provider commit even before a new React view is published", () => {
    const test = setup();
    test.binding.refresh();
    const stale = test.intent();
    test.advance(false);
    expect(test.port.emit(stale)).toMatchObject({ reason: "stale" });
    expect(test.binding.refresh()).toBe("stale");
    expect(test.context().controls.discard).not.toHaveBeenCalled();
  });

  it("reports a no-op without waiting forever and allows a fresh selection/request", () => {
    const test = setup();
    test.binding.refresh();
    vi.mocked(test.context().controls.discard).mockImplementationOnce(() => {});
    test.port.emit(test.intent());
    expect(test.port.emit(test.intent("confirm"))).toMatchObject({
      reason: "not-committed",
    });
    expect(test.binding.refresh()).toBe("unchanged");
    expect(test.port.emit(test.intent())).toEqual({ status: "selected" });
    expect(test.port.emit(test.intent("confirm"))).toEqual({
      status: "dispatched",
    });
  });

  it("propagates controls throw before commit and releases selection/waiting for a fresh request", () => {
    const test = setup();
    test.binding.refresh();
    const failure = new Error("control failed before commit");
    vi.mocked(test.context().controls.discard).mockImplementationOnce(() => {
      throw failure;
    });
    test.port.emit(test.intent());
    expect(() => test.port.emit(test.intent("confirm"))).toThrow(failure);
    expect(test.binding.refresh()).toBe("unchanged");
    expect(test.port.emit(test.intent("confirm"))).toMatchObject({
      reason: "selection-required",
    });
    expect(test.port.emit(test.intent())).toEqual({ status: "selected" });
    expect(test.port.emit(test.intent("confirm"))).toEqual({
      status: "dispatched",
    });
  });

  it("propagates controls throw after commit while stale guards remain active", () => {
    const test = setup();
    test.binding.refresh();
    const failure = new Error("control failed after commit");
    vi.mocked(test.context().controls.discard).mockImplementationOnce(() => {
      test.advance(false);
      throw failure;
    });
    test.port.emit(test.intent());
    expect(() => test.port.emit(test.intent("confirm"))).toThrow(failure);
    expect(test.port.emit(test.intent())).toMatchObject({ reason: "stale" });
    test.sync();
    test.binding.refresh();
    expect(test.port.emit(test.intent("confirm"))).toMatchObject({
      reason: "selection-required",
    });
  });

  it("new session restores and rejects old session intent/snapshot", () => {
    const test = setup();
    test.binding.refresh();
    const old = test.context();
    const oldIntent = test.intent();
    test.newSession();
    test.binding.refresh();
    expect(test.port.frames[1].mode).toBe("restore");
    expect(test.port.emit(oldIntent)).toMatchObject({ reason: "stale" });
    test.update({ ...old, readDisplaySource: () => old.displaySource! });
    expect(test.binding.refresh()).toBe("stale");
  });

  it("rejects stale revisions and drops selection on a newer frame", () => {
    const test = setup();
    test.binding.refresh();
    const previous = test.intent();
    test.port.emit(previous);
    test.advance();
    test.binding.refresh();
    expect(test.port.emit(previous)).toMatchObject({ reason: "stale" });
    expect(test.port.emit(test.intent("confirm"))).toMatchObject({
      reason: "selection-required",
    });
    const source = test.context().displaySource!;
    const old = { ...source, revision: 0 };
    test.update({ displaySource: old, readDisplaySource: () => old });
    expect(test.binding.refresh()).toBe("stale");
  });

  it("validates unknown inbound data, schema, extra fields and bounded IDs", () => {
    const test = setup();
    test.binding.refresh();
    const valid = test.intent();
    for (const invalid of [
      null,
      [],
      "json",
      42,
      {},
      { ...valid, version: 2 },
      { ...valid, protocol: "other" },
      { ...valid, kind: "discard" },
      { ...valid, revision: -1 },
      { ...valid, requestId: "" },
      { ...valid, requestId: "a".repeat(97) },
      { ...valid, tile: { suit: "honor", rank: 1 } },
      { ...valid, playerId: "p1" },
    ]) {
      expect(test.port.emit(invalid)).toMatchObject({ reason: "malformed" });
    }
    expect(
      test.port.emit(test.intent("select", { optionId: "missing" })),
    ).toMatchObject({ reason: "unknown-option" });
    expect(test.context().controls.discard).not.toHaveBeenCalled();
  });

  it("rejected intents cannot exhaust the revision's valid input budget", () => {
    const test = setup();
    test.update({ phase: "roundEnd" });
    test.binding.refresh();
    const first = test.port.frames[0];
    const request: DisplayIntent = {
      protocol: DISPLAY_PROTOCOL,
      version: 1,
      kind: "action",
      requestId: "next",
      sessionId: first.sessionId,
      revision: first.revision,
      optionId: first.snapshot.options[0].id,
    };
    expect(test.port.emit(request)).toEqual({ status: "dispatched" });
    expect(test.context().controls.nextRound).toHaveBeenCalledOnce();
    test.sync();
    test.binding.refresh();
    for (let index = 0; index < 128; index++) {
      expect(
        test.port.emit({
          ...request,
          revision: 1,
          requestId: `invalid-${index}`,
          optionId: "missing",
        }),
      ).toMatchObject({ reason: "unknown-option" });
    }
    expect(
      test.port.emit({ ...request, revision: 1, requestId: "valid" }),
    ).toEqual({ status: "dispatched" });
    expect(test.context().controls.nextRound).toHaveBeenCalledTimes(2);
  });

  it("repeated valid selection remains bounded and always permits its confirmation", () => {
    const test = setup();
    test.binding.refresh();
    for (let index = 0; index < 1024; index++) {
      expect(test.port.emit(test.intent())).toEqual({ status: "selected" });
    }
    expect(test.port.emit(test.intent("confirm"))).toEqual({
      status: "dispatched",
    });
    expect(test.context().controls.discard).toHaveBeenCalledOnce();
  });

  it("unsupported provider publishes nothing and never invokes controls", () => {
    const test = setup();
    test.update({ displaySource: undefined, readDisplaySource: undefined });
    expect(test.binding.refresh()).toBe("unsupported");
    expect(test.port.frames).toEqual([]);
    expect(
      test.port.emit({
        protocol: DISPLAY_PROTOCOL,
        version: 1,
        kind: "action",
        requestId: "x",
        sessionId: "old",
        revision: 0,
        optionId: "option-0",
      }),
    ).toMatchObject({ reason: "unsupported" });
  });

  it("disposing unsubscribes exactly once and rejects retained callbacks", async () => {
    const test = setup();
    test.binding.refresh();
    const retained = test.port.listener!;
    await test.binding.dispose();
    await test.binding.dispose();
    expect(test.port.disposed).toBe(1);
    expect(test.port.listener).toBeNull();
    expect(test.binding.refresh()).toBe("closed");
    expect(retained(test.intent())).toMatchObject({ reason: "closed" });
  });

  it("a failed publish does not advance the claimed frame", () => {
    const test = setup();
    vi.spyOn(test.port, "publish").mockImplementationOnce(() => {
      throw new Error("transport failed");
    });
    expect(() => test.binding.refresh()).toThrow("transport failed");
    expect(test.port.frames).toEqual([]);
    expect(test.binding.refresh()).toBe("published");
    expect(test.port.frames[0].mode).toBe("restore");
  });

  it("rejects synchronous reentrant input while publishing and accepts it afterwards", () => {
    const test = setup();
    const publish = test.port.publish.bind(test.port);
    let during: IntentReceipt | undefined;
    vi.spyOn(test.port, "publish").mockImplementationOnce((frame) => {
      publish(frame);
      during = test.port.emit(test.intent());
    });
    test.binding.refresh();
    expect(during).toEqual({ status: "rejected", reason: "publishing" });
    expect(test.port.emit(test.intent())).toEqual({ status: "selected" });
    expect(test.port.emit(test.intent("confirm"))).toEqual({
      status: "dispatched",
    });
    expect(test.context().controls.discard).toHaveBeenCalledOnce();
  });
});
