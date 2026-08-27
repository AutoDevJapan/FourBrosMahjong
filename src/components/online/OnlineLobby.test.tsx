import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type RefObject, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { walkToGameEnd } from "@/components/game/finishedGameFixture";
import { selectView } from "@/components/game/gameView";
import { createGame } from "@/domain/game/engine";
import OnlineLobby from "./OnlineLobby";
import type { OnlineServerMessage, OnlineSnapshot } from "./types";

vi.mock("@/components/game/GameBoard", () => ({
  default: ({
    interactionDisabled,
    interactionDisabledReason,
    onResult,
    resultButtonRef,
  }: {
    interactionDisabled?: boolean;
    interactionDisabledReason?: "reconnecting" | "failed";
    onResult?: () => void;
    resultButtonRef?: RefObject<HTMLButtonElement | null>;
  }) => (
    <div
      data-testid="game-board"
      data-interaction-disabled={String(interactionDisabled)}
      data-interaction-disabled-reason={String(interactionDisabledReason)}
    >
      対局盤
      {onResult ? (
        <button ref={resultButtonRef} type="button" onClick={onResult}>
          結果を見る
        </button>
      ) : null}
    </div>
  ),
}));

type TestListener = (event: Event) => void;

class TestWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readonly url: string;
  readonly sent: string[] = [];
  readyState = 0;
  private readonly listeners = new Map<string, Set<TestListener>>();

  constructor(url: string | URL) {
    this.url = String(url);
    sockets.push(this);
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    const callback =
      typeof listener === "function"
        ? listener
        : (event: Event) => listener.handleEvent(event);
    const callbacks = this.listeners.get(type) ?? new Set<TestListener>();
    callbacks.add(callback);
    this.listeners.set(type, callbacks);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    const callbacks = this.listeners.get(type);
    if (!callbacks) return;
    for (const callback of callbacks) {
      if (callback === listener) callbacks.delete(callback);
    }
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === TestWebSocket.CLOSED) return;
    this.readyState = TestWebSocket.CLOSED;
    this.emit("close");
  }

  open(): void {
    this.readyState = TestWebSocket.OPEN;
    this.emit("open");
  }

  fail(): void {
    this.emit("error");
  }

  message(message: OnlineServerMessage): void {
    this.emit(
      "message",
      new MessageEvent("message", { data: JSON.stringify(message) }),
    );
  }

  private emit(type: string, event: Event = new Event(type)): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const sockets: TestWebSocket[] = [];

function snapshotFixture(): OnlineSnapshot {
  const engine = createGame({ seed: 31, humanPlayerIds: ["p0"] });
  return {
    code: "ABC234",
    version: 0,
    you: "p0",
    hostId: "p0",
    phase: engine.phase,
    view: selectView(engine, "p0"),
    pending: engine.pending,
    roundSummary: engine.lastRound,
    players: [{ id: "p0", name: "たろう", connected: true, isHost: true }],
    currentTurn: "p0",
    hostNotice: null,
  };
}

function finishedSnapshotFixture(you: "p0" | "p1" = "p0"): OnlineSnapshot {
  const finished = walkToGameEnd(1).state;
  return {
    code: "ABC234",
    version: 1,
    you,
    hostId: "p0",
    phase: finished.phase,
    view: selectView(finished, you),
    pending: finished.pending,
    roundSummary: finished.lastRound,
    players: finished.players.map((player) => ({
      id: player.id,
      name: player.name,
      connected: true,
      isHost: player.id === "p0",
    })),
    currentTurn: null,
    hostNotice: null,
  };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ONLINE_WS_URL", "ws://localhost:8080/ws");
  vi.stubGlobal("WebSocket", TestWebSocket);
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/online");
  sockets.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState({}, "", "/online");
  window.sessionStorage.clear();
  sockets.length = 0;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("OnlineLobby (#605)", () => {
  it("prefills a valid room code from a shared URL", async () => {
    window.history.replaceState({}, "", "/online?room=abc234");

    render(
      <StrictMode>
        <OnlineLobby />
      </StrictMode>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("ルームコード")).toHaveValue("ABC234"),
    );
    expect(screen.getByRole("button", { name: "参加する" })).toBeDisabled();
  });

  it("ignores an invalid room code in a shared URL", async () => {
    window.history.replaceState({}, "", "/online?room=ABCI01");

    render(
      <StrictMode>
        <OnlineLobby />
      </StrictMode>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("ルームコード")).toHaveValue(""),
    );
  });

  it("does not restore a saved session whose code is no longer generated", async () => {
    window.sessionStorage.setItem(
      "four-bros-mahjong.online.session.v1",
      JSON.stringify({ code: "ABCI01", token: "i".repeat(24) }),
    );

    render(
      <StrictMode>
        <OnlineLobby />
      </StrictMode>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("ルームコード")).toHaveValue(""),
    );
    expect(sockets).toHaveLength(0);
  });

  it("keeps reconnecting a restored session under StrictMode", async () => {
    window.sessionStorage.setItem(
      "four-bros-mahjong.online.session.v1",
      JSON.stringify({ code: "ABC234", token: "t".repeat(16) }),
    );

    render(
      <StrictMode>
        <OnlineLobby />
      </StrictMode>,
    );

    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => sockets[0]?.open());
    expect(JSON.parse(sockets[0]?.sent[0] ?? "{}")).toEqual({
      type: "resume",
      code: "ABC234",
      token: "t".repeat(16),
      explicitKita: true,
    });

    act(() => sockets[0]?.close());
    await waitFor(() => expect(sockets).toHaveLength(2), { timeout: 1_500 });
  });

  it("prefers a different shared room over an old restored session", async () => {
    window.sessionStorage.setItem(
      "four-bros-mahjong.online.session.v1",
      JSON.stringify({ code: "XYZ234", token: "o".repeat(24) }),
    );
    window.history.replaceState({}, "", "/online?room=ABC234");

    render(
      <StrictMode>
        <OnlineLobby />
      </StrictMode>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("ルームコード")).toHaveValue("ABC234"),
    );
    expect(sockets).toHaveLength(0);
  });
});

describe("OnlineLobby focus lifecycle (#682)", () => {
  function startRoom(): void {
    fireEvent.change(screen.getByLabelText("表示名"), {
      target: { value: "たろう" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新しいルームを作る" }));
  }

  function completeSession(): void {
    act(() => {
      sockets[0]?.open();
      sockets[0]?.message({
        type: "session",
        token: "t".repeat(24),
        snapshot: snapshotFixture(),
      });
    });
  }

  it("moves focus to the online game heading once after session success", () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    render(<OnlineLobby />);
    startRoom();

    const focusCallsBeforeSession = focus.mock.calls.length;
    completeSession();

    expect(
      screen.getByRole("heading", { level: 1, name: "オンライン対戦" }),
    ).toHaveFocus();
    expect(
      focus.mock.calls
        .slice(focusCallsBeforeSession)
        .filter(([options]) => options?.preventScroll === true),
    ).toHaveLength(1);
  });

  it("moves focus to the lobby heading once after leaving the online game", () => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    render(<OnlineLobby />);
    startRoom();
    completeSession();

    const leaveButton = screen.getByRole("button", { name: "退出" });
    leaveButton.focus();
    const focusCallsBeforeLeave = focus.mock.calls.length;
    fireEvent.click(leaveButton);

    expect(
      screen.getByRole("heading", { level: 1, name: "オンライン対戦" }),
    ).toHaveFocus();
    expect(
      focus.mock.calls
        .slice(focusCallsBeforeLeave)
        .filter(([options]) => options?.preventScroll === true),
    ).toHaveLength(1);
  });

  it("moves focus to connection feedback once after automatic reconnect succeeds", () => {
    vi.useFakeTimers();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    render(<OnlineLobby />);
    startRoom();
    completeSession();

    act(() => sockets[0]?.close());
    expect(
      document.querySelector('[data-connection-status="reconnecting"]'),
    ).not.toBeNull();
    act(() => vi.advanceTimersByTime(500));
    expect(sockets).toHaveLength(2);

    const focusCallsBeforeReconnect = focus.mock.calls.length;
    act(() => {
      sockets[1]?.open();
      sockets[1]?.message({
        type: "session",
        token: "t".repeat(24),
        snapshot: snapshotFixture(),
      });
    });

    expect(
      document.querySelector('[data-connection-status="connected"]'),
    ).toHaveFocus();
    expect(
      focus.mock.calls
        .slice(focusCallsBeforeReconnect)
        .filter(([options]) => options?.preventScroll === true),
    ).toHaveLength(1);
  });
});

describe("OnlineLobby のキーボード送信", () => {
  it("表示名入力でEnterを押すと新しいルームを作る", async () => {
    const user = userEvent.setup();
    render(<OnlineLobby />);

    const nameInput = screen.getByLabelText("表示名");
    await user.type(nameInput, "たろう");
    await user.keyboard("{Enter}");

    expect(sockets).toHaveLength(1);
    act(() => sockets[0]?.open());
    expect(JSON.parse(sockets[0]?.sent[0] ?? "{}")).toEqual({
      type: "create",
      name: "たろう",
      explicitKita: true,
    });
  });

  it("ルームコード入力でEnterを押すと参加する", async () => {
    const user = userEvent.setup();
    render(<OnlineLobby />);

    await user.type(screen.getByLabelText("表示名"), "たろう");
    const roomCodeInput = screen.getByLabelText("ルームコード");
    await user.type(roomCodeInput, "ABC234");
    await user.keyboard("{Enter}");

    expect(sockets).toHaveLength(1);
    act(() => sockets[0]?.open());
    expect(JSON.parse(sockets[0]?.sent[0] ?? "{}")).toEqual({
      type: "join",
      code: "ABC234",
      name: "たろう",
      explicitKita: true,
    });
  });

  it("フォームsubmitは作成要求を1回だけ送る", () => {
    render(<OnlineLobby />);

    fireEvent.change(screen.getByLabelText("表示名"), {
      target: { value: "たろう" },
    });
    fireEvent.submit(
      screen.getByRole("form", { name: "オンラインルーム接続" }),
    );

    expect(sockets).toHaveLength(1);
    act(() => sockets[0]?.open());
    expect(JSON.parse(sockets[0]?.sent[0] ?? "{}")).toEqual({
      type: "create",
      name: "たろう",
      explicitKita: true,
    });
  });

  it("submitterなしでルームコードにフォーカスしてsubmitすると参加する", () => {
    render(<OnlineLobby />);

    fireEvent.change(screen.getByLabelText("表示名"), {
      target: { value: "たろう" },
    });
    const roomCodeInput = screen.getByLabelText("ルームコード");
    fireEvent.change(roomCodeInput, { target: { value: "ABC234" } });
    roomCodeInput.focus();
    fireEvent.submit(
      screen.getByRole("form", { name: "オンラインルーム接続" }),
    );

    expect(sockets).toHaveLength(1);
    act(() => sockets[0]?.open());
    expect(JSON.parse(sockets[0]?.sent[0] ?? "{}")).toEqual({
      type: "join",
      code: "ABC234",
      name: "たろう",
      explicitKita: true,
    });
  });

  it("IME変換中のEnterでは候補確定を妨げず送信しない", () => {
    const preventDefault = vi.spyOn(Event.prototype, "preventDefault");
    render(<OnlineLobby />);

    const nameInput = screen.getByLabelText("表示名");
    fireEvent.change(nameInput, { target: { value: "たろう" } });
    fireEvent.keyDown(nameInput, { key: "Enter", isComposing: true });
    const roomCodeInput = screen.getByLabelText("ルームコード");
    fireEvent.keyDown(roomCodeInput, { key: "Enter", keyCode: 229 });

    expect(sockets).toHaveLength(0);
    expect(preventDefault).not.toHaveBeenCalled();
  });
});

describe("OnlineLobby の参加条件", () => {
  it("初期状態でも入力条件とdisabled理由をアクセシブルに説明する", () => {
    render(<OnlineLobby />);

    const nameInput = screen.getByRole("textbox", { name: "表示名" });
    const roomCodeInput = screen.getByRole("textbox", { name: "ルームコード" });
    const createButton = screen.getByRole("button", {
      name: "新しいルームを作る",
    });
    const joinButton = screen.getByRole("button", { name: "参加する" });

    expect(nameInput).toBeRequired();
    expect(nameInput).toHaveAttribute("aria-invalid", "true");
    expect(nameInput).toHaveAccessibleDescription(
      /参加には表示名が必要です。表示名を入力してください/,
    );
    expect(roomCodeInput).toBeRequired();
    expect(roomCodeInput).toHaveAttribute("aria-invalid", "true");
    expect(roomCodeInput).toHaveAccessibleDescription(
      /6文字のルームコードが必要です/,
    );

    expect(createButton).toBeDisabled();
    expect(joinButton).toBeDisabled();
    expect(joinButton).toHaveAccessibleDescription(
      /表示名を入力してください。.*6文字のルームコードが必要です/,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /表示名を入力してください。.*参加には6文字のルームコードが必要です。.*ルームコードを入力してください。/,
    );
  });

  it("空・短い・不正文字・有効なルームコードを順に検証する", async () => {
    const user = userEvent.setup();
    render(<OnlineLobby />);

    const nameInput = screen.getByRole("textbox", { name: "表示名" });
    const roomCodeInput = screen.getByRole("textbox", { name: "ルームコード" });
    const createButton = screen.getByRole("button", {
      name: "新しいルームを作る",
    });
    const joinButton = screen.getByRole("button", { name: "参加する" });

    expect(roomCodeInput).toHaveAccessibleDescription(
      /参加には6文字のルームコードが必要です。ルームコードを入力してください。/,
    );
    expect(roomCodeInput).toHaveAttribute("aria-invalid", "true");
    expect(joinButton).toBeDisabled();

    await user.type(nameInput, "たろう");
    expect(createButton).toBeEnabled();

    await user.type(roomCodeInput, "ABC23");
    expect(joinButton).toBeDisabled();
    expect(roomCodeInput).toHaveAttribute("aria-invalid", "true");
    expect(roomCodeInput).toHaveAccessibleDescription(
      /ルームコードは6文字必要です。あと1文字入力してください。/,
    );

    await user.clear(roomCodeInput);
    await user.type(roomCodeInput, "ABC!");
    expect(joinButton).toBeDisabled();
    expect(roomCodeInput).toHaveAttribute("aria-invalid", "true");
    expect(roomCodeInput).toHaveAccessibleDescription(
      /英大文字と2〜9の数字を使った6文字で入力してください。.*あと2文字入力してください。/,
    );
    expect(joinButton).toHaveAccessibleDescription(
      /英大文字と2〜9の数字を使った6文字で入力してください。.*あと2文字入力してください。/,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      /英大文字と2〜9の数字を使った6文字で入力してください。.*あと2文字入力してください。/,
    );

    await user.clear(roomCodeInput);
    await user.type(roomCodeInput, "ABC!@#");
    expect(joinButton).toBeDisabled();
    expect(roomCodeInput).toHaveAttribute("aria-invalid", "true");
    expect(roomCodeInput).toHaveAccessibleDescription(
      /英大文字と2〜9の数字を使った6文字で入力してください。/,
    );

    await user.clear(roomCodeInput);
    await user.type(roomCodeInput, "ABC234");
    expect(roomCodeInput).toHaveAttribute("aria-invalid", "false");
    expect(roomCodeInput).toHaveAccessibleDescription(
      /ルームコードは6文字入力されています。/,
    );
    expect(joinButton).toBeEnabled();
    expect(joinButton).toHaveAccessibleDescription(
      /参加条件を満たしています。参加できます。/,
    );
  });

  it("I/O/0/1を含むコードを参加前に具体的に拒否する", async () => {
    const user = userEvent.setup();
    render(<OnlineLobby />);

    await user.type(screen.getByLabelText("表示名"), "たろう");
    const roomCodeInput = screen.getByLabelText("ルームコード");
    await user.type(roomCodeInput, "abci01");

    expect(roomCodeInput).toHaveValue("ABCI01");
    expect(roomCodeInput).toHaveAttribute("aria-invalid", "true");
    expect(roomCodeInput).toHaveAccessibleDescription(/I\/O\/0\/1/);
    expect(screen.getByRole("button", { name: "参加する" })).toBeDisabled();

    await user.keyboard("{Enter}");
    expect(sockets).toHaveLength(0);
  });

  it("表示名は絵文字を1書記素として制限し、lone surrogateを修復する", async () => {
    const user = userEvent.setup();
    render(<OnlineLobby />);
    const input = screen.getByLabelText("表示名") as HTMLInputElement;
    const withinLimit = `${"あ".repeat(11)}😀`;

    await user.click(input);
    await user.paste(`${withinLimit}超過`);
    expect(input).toHaveValue(withinLimit);
    expect(input.value).not.toMatch(/[\uD800-\uDFFF]/u);

    fireEvent.change(input, { target: { value: "名前\uD83D" } });
    expect(input).toHaveValue("名前�");
  });

  it("IME変換中は読みを保持し、確定時に書記素上限を適用する", () => {
    render(<OnlineLobby />);
    const input = screen.getByLabelText("表示名");
    const reading = "にほんごにゅうりょくてすと";
    const converted = "日本語入力テスト";
    const tooLong = "あ".repeat(15);

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: reading } });
    expect(input, "変換中は読みをそのまま保持する").toHaveValue(reading);

    fireEvent.change(input, { target: { value: converted } });
    fireEvent.compositionEnd(input, { target: { value: converted } });
    expect(input).toHaveValue(converted);

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: tooLong } });
    fireEvent.compositionEnd(input, { target: { value: tooLong } });
    expect(input).toHaveValue("あ".repeat(12));
  });
});

describe("OnlineLobby connection recovery", () => {
  it("preserves handshake rate-limit details and blocks retry during cooldown", () => {
    vi.useFakeTimers();
    render(<OnlineLobby />);

    fireEvent.change(screen.getByLabelText("表示名"), {
      target: { value: "たろう" },
    });
    fireEvent.change(screen.getByLabelText("ルームコード"), {
      target: { value: "ABC234" },
    });
    fireEvent.click(screen.getByRole("button", { name: "参加する" }));

    act(() => {
      sockets[0]?.open();
      sockets[0]?.message({
        type: "error",
        message: "参加の試行回数が上限に達しました。",
        code: "rate_limited",
        scope: "join",
        retryAfterMs: 5_000,
      });
    });

    expect(
      screen.getByText("参加の試行回数が上限に達しました。"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("再試行まで約5秒お待ちください。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再試行" })).toBeDisabled();

    act(() => vi.advanceTimersByTime(4_999));
    expect(screen.getByRole("button", { name: "再試行" })).toBeDisabled();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("button", { name: "再試行" })).toBeEnabled();
  });

  it("keeps the server rate-limit message after an established socket closes", () => {
    vi.useFakeTimers();
    render(<OnlineLobby />);

    fireEvent.change(screen.getByLabelText("表示名"), {
      target: { value: "たろう" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新しいルームを作る" }));

    act(() => {
      sockets[0]?.open();
      sockets[0]?.message({
        type: "session",
        token: "t".repeat(24),
        snapshot: snapshotFixture(),
      });
    });
    expect(screen.getByTestId("game-board")).toHaveAttribute(
      "data-interaction-disabled",
      "false",
    );
    expect(screen.getByTestId("game-board")).toHaveAttribute(
      "data-interaction-disabled-reason",
      "undefined",
    );

    act(() => {
      sockets[0]?.message({
        type: "error",
        message: "対局操作が多すぎます。",
        code: "rate_limited",
        scope: "action",
        retryAfterMs: 4_000,
      });
      sockets[0]?.close();
    });

    expect(screen.getByText("対局操作が多すぎます。")).toBeInTheDocument();
    expect(
      screen.queryByText(
        "オンラインサーバーとの接続が切れました。再接続しています。",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("再試行まで約4秒お待ちください。"),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-connection-status="reconnecting"]'),
    ).not.toBeNull();
    expect(screen.getByTestId("game-board")).toHaveAttribute(
      "data-interaction-disabled",
      "true",
    );
    expect(screen.getByTestId("game-board")).toHaveAttribute(
      "data-interaction-disabled-reason",
      "reconnecting",
    );

    act(() => vi.advanceTimersByTime(3_999));
    expect(sockets).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(sockets).toHaveLength(2);
  });

  it("detects a silent half-open socket and enters reconnecting state", () => {
    vi.useFakeTimers();
    render(<OnlineLobby />);

    fireEvent.change(screen.getByLabelText("表示名"), {
      target: { value: "たろう" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新しいルームを作る" }));

    act(() => {
      sockets[0]?.open();
      sockets[0]?.message({
        type: "session",
        token: "t".repeat(24),
        snapshot: snapshotFixture(),
      });
      vi.advanceTimersByTime(15_000);
    });

    expect(
      sockets[0]?.sent.some((value) => JSON.parse(value).type === "ping"),
    ).toBe(true);

    act(() => vi.advanceTimersByTime(30_000));

    expect(
      document.querySelector('[data-connection-status="reconnecting"]'),
    ).not.toBeNull();
    expect(
      screen.getByText(
        "オンラインサーバーの応答が確認できないため、再接続しています。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("game-board")).toHaveAttribute(
      "data-interaction-disabled",
      "true",
    );
    expect(sockets[0]?.readyState).toBe(TestWebSocket.CLOSED);
    expect(sockets).toHaveLength(1);
  });

  it("keeps an idle connection alive when pong responses arrive", () => {
    vi.useFakeTimers();
    render(<OnlineLobby />);

    fireEvent.change(screen.getByLabelText("表示名"), {
      target: { value: "たろう" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新しいルームを作る" }));

    act(() => {
      sockets[0]?.open();
      sockets[0]?.message({
        type: "session",
        token: "t".repeat(24),
        snapshot: snapshotFixture(),
      });
    });

    for (let index = 0; index < 4; index += 1) {
      act(() => vi.advanceTimersByTime(15_000));
      act(() => sockets[0]?.message({ type: "pong" }));
    }

    expect(
      document.querySelector('[data-connection-status="connected"]'),
    ).not.toBeNull();
    expect(sockets).toHaveLength(1);
  });

  it("stops heartbeat and automatic reconnect after a deliberate leave", () => {
    vi.useFakeTimers();
    render(<OnlineLobby />);

    fireEvent.change(screen.getByLabelText("表示名"), {
      target: { value: "たろう" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新しいルームを作る" }));

    act(() => {
      sockets[0]?.open();
      sockets[0]?.message({
        type: "session",
        token: "t".repeat(24),
        snapshot: snapshotFixture(),
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "退出" }));
    expect(sockets[0]?.readyState).toBe(TestWebSocket.CLOSED);
    expect(
      sockets[0]?.sent
        .map((value) => JSON.parse(value))
        .some((message) => message.type === "leave"),
    ).toBe(true);

    act(() => vi.advanceTimersByTime(60_000));

    expect(sockets).toHaveLength(1);
    expect(
      sockets[0]?.sent.filter((value) => JSON.parse(value).type === "ping"),
    ).toHaveLength(0);
    expect(
      document.querySelector('[data-connection-status="idle"]'),
    ).not.toBeNull();
  });

  it("shows the host handoff reason and the next operation in the online snapshot", () => {
    render(<OnlineLobby />);

    fireEvent.change(screen.getByLabelText("表示名"), {
      target: { value: "ゲスト" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新しいルームを作る" }));

    const handoff = {
      ...snapshotFixture(),
      you: "p1" as const,
      hostId: "p1" as const,
      players: [
        { id: "p0" as const, name: "ホスト", connected: false, isHost: false },
        { id: "p1" as const, name: "ゲスト", connected: true, isHost: true },
      ],
      hostNotice: {
        reason: "disconnected" as const,
        message: "ホストが切断したため、ゲストへホスト権限を引き継ぎました。",
        nextAction: "「次の局へ」を押して対局を続けてください。",
      },
    };
    act(() => {
      sockets[0]?.open();
      sockets[0]?.message({
        type: "session",
        token: "t".repeat(24),
        snapshot: handoff,
      });
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "ホストが切断したため、ゲストへホスト権限を引き継ぎました。",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "次の操作: 「次の局へ」を押して対局を続けてください。",
    );
  });

  it("shows the released guest seat and the next operation after an explicit leave", () => {
    render(<OnlineLobby />);

    fireEvent.change(screen.getByLabelText("表示名"), {
      target: { value: "ホスト" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新しいルームを作る" }));

    act(() => {
      sockets[0]?.open();
      sockets[0]?.message({
        type: "session",
        token: "t".repeat(24),
        snapshot: {
          ...snapshotFixture(),
          players: [
            { id: "p0", name: "ホスト", connected: true, isHost: true },
            { id: "p1", name: "ゲスト", connected: false, isHost: false },
          ],
          departureNotice: {
            playerId: "p1",
            playerName: "ゲスト",
            message: "「ゲスト」さんが退出したため、その席をAIに戻しました。",
            nextAction: "表示された現在の手番に従って操作してください。",
          },
        },
      });
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "「ゲスト」さんが退出したため、その席をAIに戻しました。",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "次の操作: 表示された現在の手番に従って操作してください。",
    );
    expect(screen.getByText("ゲスト（切断）")).toBeInTheDocument();
  });

  it("bounds an oversized retryAfterMs value", () => {
    vi.useFakeTimers();
    render(<OnlineLobby />);

    fireEvent.change(screen.getByLabelText("表示名"), {
      target: { value: "たろう" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新しいルームを作る" }));

    act(() => {
      sockets[0]?.open();
      sockets[0]?.message({
        type: "error",
        message: "ルーム作成の試行回数が上限に達しました。",
        code: "rate_limited",
        scope: "create",
        retryAfterMs: Number.MAX_VALUE,
      });
    });

    expect(
      screen.getByText("再試行まで約600秒お待ちください。"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再試行" })).toBeDisabled();

    act(() => vi.advanceTimersByTime(10 * 60 * 1000));
    expect(screen.getByRole("button", { name: "再試行" })).toBeEnabled();
  });

  it("clears a rejected operation after its authoritative snapshot and next success", () => {
    render(<OnlineLobby />);

    fireEvent.change(screen.getByLabelText("表示名"), {
      target: { value: "たろう" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新しいルームを作る" }));

    act(() => {
      sockets[0]?.open();
      sockets[0]?.message({
        type: "session",
        token: "t".repeat(24),
        snapshot: snapshotFixture(),
      });
      sockets[0]?.message({
        type: "error",
        message: "対局状態が更新されています。最新状態を受信しました。",
      });
    });

    const staleMessage = "対局状態が更新されています。最新状態を受信しました。";
    expect(screen.getByText(staleMessage)).toBeInTheDocument();
    expect(
      screen
        .getByText(staleMessage)
        .closest('[data-connection-status="connected"]'),
    ).not.toBeNull();

    act(() => {
      sockets[0]?.message({
        type: "snapshot",
        snapshot: { ...snapshotFixture(), version: 1 },
      });
    });

    expect(screen.queryByText(staleMessage)).not.toBeInTheDocument();
    expect(
      document.querySelector('[data-connection-status="connected"]'),
    ).not.toBeNull();

    // A later rejection is also retired by the next successful authoritative
    // snapshot, without re-announcing the old wording.
    act(() => {
      sockets[0]?.message({
        type: "error",
        message: "現在はあなたの操作順ではありません。",
      });
      sockets[0]?.message({
        type: "snapshot",
        snapshot: { ...snapshotFixture(), version: 2 },
      });
    });
    expect(
      screen.queryByText("現在はあなたの操作順ではありません。"),
    ).not.toBeInTheDocument();
  });

  it("does not clear rate-limit guidance when a snapshot follows it", () => {
    vi.useFakeTimers();
    render(<OnlineLobby />);

    fireEvent.change(screen.getByLabelText("表示名"), {
      target: { value: "たろう" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新しいルームを作る" }));

    const rateLimitMessage = "対局操作が多すぎます。";
    act(() => {
      sockets[0]?.open();
      sockets[0]?.message({
        type: "session",
        token: "t".repeat(24),
        snapshot: snapshotFixture(),
      });
      sockets[0]?.message({
        type: "error",
        message: rateLimitMessage,
        code: "rate_limited",
        scope: "action",
        retryAfterMs: 4_000,
      });
      sockets[0]?.message({
        type: "snapshot",
        snapshot: { ...snapshotFixture(), version: 1 },
      });
    });

    expect(screen.getAllByText(rateLimitMessage)).toHaveLength(1);
    expect(
      screen.getByText("再試行まで約4秒お待ちください。"),
    ).toBeInTheDocument();
    const feedback = document.querySelector(
      '[data-connection-status="connected"]',
    );
    expect(feedback?.querySelectorAll('[aria-live="polite"]')).toHaveLength(2);
    expect(feedback?.querySelectorAll('[role="status"]')).toHaveLength(2);

    const oversizedMessage = "メッセージが大きすぎます。";
    act(() => {
      sockets[0]?.message({
        type: "error",
        message: oversizedMessage,
        code: "message_too_large",
      });
      sockets[0]?.message({
        type: "snapshot",
        snapshot: { ...snapshotFixture(), version: 2 },
      });
    });
    expect(screen.getAllByText(oversizedMessage)).toHaveLength(1);
  });

  it("shows a retry action after a failed connection and keeps the form values", async () => {
    const user = userEvent.setup();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    render(<OnlineLobby />);

    await user.type(screen.getByLabelText("表示名"), "たろう");
    await user.type(screen.getByLabelText("ルームコード"), "abc234");
    await user.click(screen.getByRole("button", { name: "参加する" }));

    expect(
      document.querySelector('[data-connection-status="connecting"]'),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "参加する" })).toBeDisabled();

    act(() => sockets[0]?.fail());

    expect(
      document.querySelector('[data-connection-status="failed"]'),
    ).not.toBeNull();
    expect(
      screen.getByText(
        "オンラインサーバーへの接続に失敗しました。再試行してください。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("オンラインサーバーへ接続しています…"),
    ).not.toBeInTheDocument();
    const retryButton = screen.getByRole("button", { name: "再試行" });
    expect(retryButton).toBeEnabled();
    expect(retryButton).toHaveFocus();
    expect(document.activeElement).toBe(retryButton);
    expect(screen.getByLabelText("表示名")).toHaveValue("たろう");
    expect(screen.getByLabelText("ルームコード")).toHaveValue("ABC234");

    const focusCallsBeforeRetry = focus.mock.calls.length;
    await user.keyboard("{Enter}");

    expect(
      document.querySelector('[data-connection-status="reconnecting"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-connection-status="reconnecting"]'),
    ).toHaveFocus();
    expect(sockets).toHaveLength(2);
    expect(
      focus.mock.calls
        .slice(focusCallsBeforeRetry)
        .filter(([options]) => options?.preventScroll === true),
    ).toHaveLength(1);

    act(() => sockets[1]?.open());
    expect(JSON.parse(sockets[1]?.sent[0] ?? "{}")).toEqual({
      type: "join",
      code: "ABC234",
      name: "たろう",
      explicitKita: true,
    });

    const focusCallsBeforeSession = focus.mock.calls.length;
    act(() =>
      sockets[1]?.message({
        type: "session",
        token: "t".repeat(24),
        snapshot: snapshotFixture(),
      }),
    );

    await waitFor(() => {
      expect(
        document.querySelector('[data-connection-status="connected"]'),
      ).not.toBeNull();
    });
    expect(
      screen.getByText("オンラインサーバーに接続しました。"),
    ).toBeInTheDocument();
    expect(
      document.querySelector('[data-connection-status="connected"]'),
    ).toHaveFocus();
    expect(
      focus.mock.calls
        .slice(focusCallsBeforeSession)
        .filter(([options]) => options?.preventScroll === true),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("heading", {
        level: 1,
        name: "オンライン対戦",
      }),
    ).toHaveLength(1);
    expect(
      screen.getByRole("region", { name: "オンライン対局" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("game-board")).toHaveAttribute(
      "data-interaction-disabled",
      "false",
    );
  });

  it("保持したsnapshotでも自動再接続終了後は再試行案内へ切り替える", () => {
    vi.useFakeTimers();
    render(<OnlineLobby />);

    fireEvent.change(screen.getByLabelText("表示名"), {
      target: { value: "たろう" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新しいルームを作る" }));

    act(() => {
      sockets[0]?.open();
      sockets[0]?.message({
        type: "session",
        token: "t".repeat(24),
        snapshot: snapshotFixture(),
      });
      sockets[0]?.close();
    });

    // 初回を含む5回の自動再接続をすべて失敗させ、6回目の失敗でfailedへ遷移する。
    for (const [socketIndex, delay] of [
      [1, 500],
      [2, 1_000],
      [3, 2_000],
      [4, 4_000],
      [5, 8_000],
    ] as const) {
      act(() => vi.advanceTimersByTime(delay));
      expect(sockets).toHaveLength(socketIndex + 1);
      act(() => sockets[socketIndex]?.fail());
    }

    expect(
      document.querySelector('[data-connection-status="failed"]'),
    ).not.toBeNull();
    const retryButton = screen.getByRole("button", { name: "再試行" });
    expect(retryButton).toHaveFocus();
    expect(document.activeElement).toBe(retryButton);
    expect(screen.getByTestId("game-board")).toHaveAttribute(
      "data-interaction-disabled",
      "true",
    );
    expect(screen.getByTestId("game-board")).toHaveAttribute(
      "data-interaction-disabled-reason",
      "failed",
    );
  });

  it("clears saved credentials before starting a new room request", async () => {
    window.sessionStorage.setItem(
      "four-bros-mahjong.online.session.v1",
      JSON.stringify({ code: "XYZ234", token: "o".repeat(24) }),
    );
    const user = userEvent.setup();
    render(<OnlineLobby />);

    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => {
      sockets[0]?.open();
      sockets[0]?.message({
        type: "error",
        message: "再接続情報が無効です。",
      });
    });
    await waitFor(() => {
      expect(
        document.querySelector('[data-connection-status="failed"]'),
      ).not.toBeNull();
    });

    await user.type(screen.getByLabelText("表示名"), "たろう");
    await user.click(
      screen.getByRole("button", { name: "新しいルームを作る" }),
    );
    expect(sockets).toHaveLength(2);

    act(() => sockets[1]?.fail());
    await waitFor(() => {
      expect(
        document.querySelector('[data-connection-status="failed"]'),
      ).not.toBeNull();
    });
    expect(sockets).toHaveLength(2);
    expect(
      window.sessionStorage.getItem("four-bros-mahjong.online.session.v1"),
    ).toBeNull();
  });
});

describe("OnlineLobby の終局結果導線", () => {
  it("終局snapshotの結果を見るでオンライン結果を表示し、同じ終局画面へ戻らない", () => {
    render(<OnlineLobby />);

    fireEvent.change(screen.getByLabelText("表示名"), {
      target: { value: "たろう" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新しいルームを作る" }));

    act(() => {
      sockets[0]?.open();
      sockets[0]?.message({
        type: "session",
        token: "t".repeat(24),
        snapshot: finishedSnapshotFixture(),
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "結果を見る" }));

    expect(
      screen.getByRole("heading", { level: 2, name: "対局結果" }),
    ).toHaveFocus();
    expect(
      screen.getByRole("heading", { level: 3, name: "最終順位" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "ソシー内訳（素点＋ウマ・オカ＋役満祝儀）",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "対局画面へ戻る" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "新しい半荘を開始" }),
    ).toBeEnabled();
    expect(screen.queryByText("優勝")).not.toBeInTheDocument();
    expect(document.querySelector(".result-ranking-row")).toBeNull();
    expect(document.querySelector(".result-breakdown-card")).toBeNull();
    expect(screen.queryByTestId("game-board")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "対局画面へ戻る" }));
    expect(screen.getByTestId("game-board")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "結果を見る" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "結果を見る" }));
    fireEvent.click(screen.getByRole("button", { name: "新しい半荘を開始" }));
    expect(JSON.parse(sockets[0]?.sent.at(-1) ?? "{}")).toEqual({
      type: "newGame",
    });

    act(() => {
      sockets[0]?.message({
        type: "snapshot",
        snapshot: snapshotFixture(),
      });
    });
    expect(screen.getByTestId("game-board")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "結果を見る" })).toHaveFocus();
  });

  it("guestは結果ビューの新局CTAをdisabledにし、対局画面へ戻っても送信しない", () => {
    render(<OnlineLobby />);

    fireEvent.change(screen.getByLabelText("表示名"), {
      target: { value: "じろう" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新しいルームを作る" }));

    act(() => {
      sockets[0]?.open();
      sockets[0]?.message({
        type: "session",
        token: "t".repeat(24),
        snapshot: finishedSnapshotFixture("p1"),
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "結果を見る" }));

    const newGameButton = screen.getByRole("button", {
      name: "新しい半荘を開始",
    });
    expect(newGameButton).toBeDisabled();
    expect(newGameButton).toHaveAccessibleDescription(
      "新しい半荘を開始できるのはホストだけです。",
    );
    fireEvent.click(newGameButton);
    expect(
      sockets[0]?.sent.some(
        (message) => JSON.parse(message).type === "newGame",
      ),
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "対局画面へ戻る" }));
    expect(screen.getByTestId("game-board")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "新しい半荘を開始" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "結果を見る" })).toHaveFocus();
    expect(
      sockets[0]?.sent.some(
        (message) => JSON.parse(message).type === "newGame",
      ),
    ).toBe(false);
  });

  it("新局snapshot後は結果を見るまで結果を自動表示しない", () => {
    render(<OnlineLobby />);

    fireEvent.change(screen.getByLabelText("表示名"), {
      target: { value: "たろう" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新しいルームを作る" }));

    act(() => {
      sockets[0]?.open();
      sockets[0]?.message({
        type: "session",
        token: "t".repeat(24),
        snapshot: finishedSnapshotFixture(),
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "結果を見る" }));

    act(() => {
      sockets[0]?.message({
        type: "snapshot",
        snapshot: snapshotFixture(),
      });
    });
    expect(
      screen.queryByRole("heading", { level: 2, name: "対局結果" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("game-board")).toBeInTheDocument();

    // 新局から終局snapshotを受けても、ユーザーが「結果を見る」を押すまでは開かない。
    act(() => {
      sockets[0]?.message({
        type: "snapshot",
        snapshot: finishedSnapshotFixture(),
      });
    });
    expect(
      screen.queryByRole("heading", { level: 2, name: "対局結果" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "結果を見る" }));
    expect(
      screen.getByRole("heading", { level: 2, name: "対局結果" }),
    ).toBeInTheDocument();
  });
});
