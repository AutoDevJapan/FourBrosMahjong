import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectView } from "@/components/game/gameView";
import { createGame } from "@/domain/game/engine";
import OnlineLobby from "./OnlineLobby";
import type { OnlineServerMessage, OnlineSnapshot } from "./types";

vi.mock("@/components/game/GameBoard", () => ({
  default: ({
    interactionDisabled,
    interactionDisabledReason,
  }: {
    interactionDisabled?: boolean;
    interactionDisabledReason?: "reconnecting" | "failed";
  }) => (
    <div
      data-testid="game-board"
      data-interaction-disabled={String(interactionDisabled)}
      data-interaction-disabled-reason={String(interactionDisabledReason)}
    >
      対局盤
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
    phase: engine.phase,
    view: selectView(engine, "p0"),
    pending: engine.pending,
    roundSummary: engine.lastRound,
    players: [{ id: "p0", name: "たろう", connected: true, isHost: true }],
    currentTurn: "p0",
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
    window.history.replaceState({}, "", "/online?room=ABC123");

    render(
      <StrictMode>
        <OnlineLobby />
      </StrictMode>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("ルームコード")).toHaveValue(""),
    );
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
    });

    act(() => sockets[0]?.close());
    await waitFor(() => expect(sockets).toHaveLength(2), { timeout: 1_500 });
  });

  it("prefers a different shared room over an old restored session", async () => {
    window.sessionStorage.setItem(
      "four-bros-mahjong.online.session.v1",
      JSON.stringify({ code: "OLD234", token: "o".repeat(24) }),
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
    });
  });

  it("IME変換中のEnterでは送信しない", () => {
    render(<OnlineLobby />);

    const nameInput = screen.getByLabelText("表示名");
    fireEvent.change(nameInput, { target: { value: "たろう" } });
    fireEvent.keyDown(nameInput, { key: "Enter", isComposing: true });

    expect(sockets).toHaveLength(0);
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

    act(() => vi.advanceTimersByTime(60_000));

    expect(sockets).toHaveLength(1);
    expect(
      sockets[0]?.sent.filter((value) => JSON.parse(value).type === "ping"),
    ).toHaveLength(0);
    expect(
      document.querySelector('[data-connection-status="idle"]'),
    ).not.toBeNull();
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

  it("shows a retry action after a failed connection and keeps the form values", async () => {
    const user = userEvent.setup();
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
    expect(screen.getByRole("button", { name: "再試行" })).toBeEnabled();
    expect(screen.getByLabelText("表示名")).toHaveValue("たろう");
    expect(screen.getByLabelText("ルームコード")).toHaveValue("ABC234");

    await user.click(screen.getByRole("button", { name: "再試行" }));

    expect(
      document.querySelector('[data-connection-status="reconnecting"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-connection-status="reconnecting"]'),
    ).toHaveFocus();
    expect(sockets).toHaveLength(2);

    act(() => sockets[1]?.open());
    expect(JSON.parse(sockets[1]?.sent[0] ?? "{}")).toEqual({
      type: "join",
      code: "ABC234",
      name: "たろう",
    });

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
      screen.getAllByRole("heading", {
        level: 1,
        name: "オンライン対戦",
      }),
    ).toHaveLength(1);
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
      JSON.stringify({ code: "OLD234", token: "o".repeat(24) }),
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
