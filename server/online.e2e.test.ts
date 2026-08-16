import { type ChildProcess, spawn } from "node:child_process";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type {
  OnlineServerMessage,
  OnlineSnapshot,
} from "../src/components/online/types";

/**
 * server配下の test/spec ファイルは既存の Vitest unit project が収集する。
 * 本番WebSocketやPlaywrightを使わず、ローカルserver:startだけをfixture内で起動する。
 */
const TEST_ORIGIN = "http://online-e2e.local";
const TEST_TIMEOUT_MS = 30_000;
const SERVER_START_TIMEOUT_MS = 10_000;

type ProtocolMessage = OnlineServerMessage;

interface LocalOnlineServer {
  readonly child: ChildProcess;
  readonly url: string;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function freePort(): Promise<number> {
  const probe = createServer();
  return new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close();
        reject(new Error("テスト用ポートを取得できませんでした。"));
        return;
      }
      probe.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function waitForServer(
  url: string,
  child: ChildProcess,
  output: readonly string[],
): Promise<void> {
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `オンラインサーバーが起動前に終了しました。\n${output.join("")}`,
      );
    }
    try {
      const response = await fetch(`${url}/healthz`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return;
    } catch {
      // 起動完了まで短く待つ。
    }
    await delay(50);
  }
  throw new Error(
    `オンラインサーバーの起動がタイムアウトしました。\n${output.join("")}`,
  );
}

async function startLocalOnlineServer(): Promise<LocalOnlineServer> {
  const port = await freePort();
  const output: string[] = [];
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(pnpm, ["server:start"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ALLOWED_ORIGINS: TEST_ORIGIN,
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  const url = `http://127.0.0.1:${port}`;
  try {
    await waitForServer(url, child, output);
  } catch (error) {
    if (child.exitCode === null) child.kill("SIGTERM");
    throw error;
  }
  return { child, url };
}

async function stopLocalOnlineServer(server: LocalOnlineServer): Promise<void> {
  if (server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (server.child.exitCode === null) server.child.kill("SIGKILL");
      resolve();
    }, 2_000);
    server.child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

type MessagePredicate = (message: ProtocolMessage) => boolean;

class OnlineTestClient {
  private readonly socket: WebSocket;
  private readonly queue: ProtocolMessage[] = [];
  private readonly waiters: Array<{
    readonly predicate: MessagePredicate;
    readonly resolve: (message: ProtocolMessage) => void;
    readonly reject: (error: Error) => void;
    readonly timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(readonly url: string) {
    this.socket = new WebSocket(`${url}/ws`, { origin: TEST_ORIGIN });
    this.socket.on("message", (data) => {
      let message: ProtocolMessage;
      try {
        message = JSON.parse(data.toString()) as ProtocolMessage;
      } catch {
        this.rejectAll(
          new Error("オンラインサーバーの応答がJSONではありません。"),
        );
        return;
      }
      this.enqueue(message);
    });
    this.socket.on("error", (error) => {
      this.rejectAll(
        error instanceof Error
          ? error
          : new Error("オンラインWebSocketでエラーが発生しました。"),
      );
    });
  }

  async open(): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return;
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        this.socket.off("error", onError);
        resolve();
      };
      const onError = (error: Error) => {
        this.socket.off("open", onOpen);
        reject(error);
      };
      this.socket.once("open", onOpen);
      this.socket.once("error", onError);
    });
  }

  send(value: unknown): void {
    this.socket.send(JSON.stringify(value));
  }

  waitFor<T extends ProtocolMessage>(
    predicate: (message: ProtocolMessage) => message is T,
    timeoutMs = TEST_TIMEOUT_MS,
  ): Promise<T> {
    const queuedIndex = this.queue.findIndex(predicate);
    if (queuedIndex >= 0) {
      return Promise.resolve(this.queue.splice(queuedIndex, 1)[0] as T);
    }
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex(
          (waiter) => waiter.timer === timer,
        );
        if (index >= 0) this.waiters.splice(index, 1);
        reject(
          new Error(
            "オンラインサーバーから期待した応答を受信できませんでした。",
          ),
        );
      }, timeoutMs);
      this.waiters.push({
        predicate,
        resolve: (message) => resolve(message as T),
        reject,
        timer,
      });
    });
  }

  async waitForSession(): Promise<
    Extract<ProtocolMessage, { type: "session" }>
  > {
    return this.waitFor(
      (message): message is Extract<ProtocolMessage, { type: "session" }> =>
        message.type === "session",
    );
  }

  async waitForSnapshot(
    predicate: (snapshot: OnlineSnapshot) => boolean,
  ): Promise<OnlineSnapshot> {
    const message = await this.waitFor(
      (
        candidate,
      ): candidate is Extract<ProtocolMessage, { type: "snapshot" }> =>
        candidate.type === "snapshot" && predicate(candidate.snapshot),
    );
    return message.snapshot;
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      this.socket.once("close", () => resolve());
      this.socket.close();
    });
  }

  private enqueue(message: ProtocolMessage): void {
    for (let index = 0; index < this.waiters.length; index += 1) {
      const waiter = this.waiters[index];
      if (!waiter.predicate(message)) continue;
      this.waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
      return;
    }
    this.queue.push(message);
  }

  private rejectAll(error: Error): void {
    while (this.waiters.length > 0) {
      const waiter = this.waiters.pop();
      if (!waiter) continue;
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }
}

function isHumanDiscardPending(
  pending: NonNullable<OnlineSnapshot["pending"]>,
): pending is Extract<
  NonNullable<OnlineSnapshot["pending"]>,
  { kind: "humanDiscard" }
> {
  return pending.kind === "humanDiscard";
}

function sameTileKind(
  left: { readonly suit: string; readonly rank: number },
  right: { readonly suit: string; readonly rank: number },
): boolean {
  return left.suit === right.suit && left.rank === right.rank;
}

function actionFor(snapshot: OnlineSnapshot): Record<string, unknown> {
  const pending = snapshot.pending;
  if (pending === null)
    throw new Error("操作担当クライアントにpendingがありません。");
  if (pending.kind === "humanReact") {
    if (pending.canRon) return { type: "ron" };
    if (pending.canPon) return { type: "pon" };
    if (pending.canKan) return { type: "kan" };
    return { type: "passRon" };
  }
  if (pending.locked) return { type: "tsumogiri" };
  if (pending.canTsumo) return { type: "tsumo" };
  if (!isHumanDiscardPending(pending)) {
    throw new Error("未知のオンライン入力待ちです。");
  }
  const self = snapshot.view.slots.self;
  if (self.kind !== "seated" || self.player.hand === undefined) {
    throw new Error("自家手牌がスナップショットにありません。");
  }
  const tile = self.player.hand.find(
    (candidate) =>
      !pending.forbiddenDiscards.some((forbidden) =>
        sameTileKind(candidate, forbidden),
      ),
  );
  if (tile === undefined) {
    throw new Error("打牌可能な牌をスナップショットから選べませんでした。");
  }
  return { type: "discard", tile };
}

function playerConnected(
  snapshot: OnlineSnapshot,
  playerId: OnlineSnapshot["you"],
): boolean {
  return (
    snapshot.players.find((player) => player.id === playerId)?.connected ===
    true
  );
}

async function advanceVersion(
  clients: readonly OnlineTestClient[],
  version: number,
  actor: OnlineTestClient,
  action: Record<string, unknown>,
): Promise<readonly [OnlineSnapshot, OnlineSnapshot]> {
  actor.send({ type: "action", version, action });
  const nextVersion = version + 1;
  const [first, second] = await Promise.all(
    clients.map((client) =>
      client.waitForSnapshot((snapshot) => snapshot.version === nextVersion),
    ),
  );
  expect(first.version).toBe(second.version);
  expect(first.currentTurn).toBe(second.currentTurn);
  expect(first.phase).toBe(second.phase);
  return [first, second];
}

describe("online multiplayer local E2E (#629)", () => {
  let server: LocalOnlineServer | undefined;
  const clients: OnlineTestClient[] = [];

  beforeAll(async () => {
    server = await startLocalOnlineServer();
  }, SERVER_START_TIMEOUT_MS + 5_000);

  afterAll(async () => {
    await Promise.allSettled(clients.map((client) => client.close()));
    if (server !== undefined) await stopLocalOnlineServer(server);
  });

  it(
    "2クライアントで作成・参加・開始・同期操作・結果・resume/reconnectを完走する",
    async () => {
      if (server === undefined)
        throw new Error("テストサーバーが起動していません。");
      const host = new OnlineTestClient(server.url);
      let guest = new OnlineTestClient(server.url);
      clients.push(host, guest);
      await Promise.all([host.open(), guest.open()]);

      host.send({ type: "create", name: "ホスト" });
      const hostSession = await host.waitForSession();
      const code = hostSession.snapshot.code;
      expect(code).toMatch(/^[A-Z2-9]{6}$/);
      expect(hostSession.snapshot.phase).toBe("playing");
      expect(hostSession.snapshot.you).toBe("p0");

      guest.send({ type: "join", code: code.toLowerCase(), name: "ゲスト" });
      const guestSession = await guest.waitForSession();
      expect(guestSession.snapshot.code).toBe(code);
      expect(guestSession.snapshot.you).toBe("p1");
      expect(guestSession.snapshot.phase).toBe("playing");
      const hostJoinedSnapshot = await host.waitForSnapshot(
        (snapshot) =>
          snapshot.version === 0 &&
          snapshot.players.length === 2 &&
          playerConnected(snapshot, "p1"),
      );
      expect(hostJoinedSnapshot.players.map((player) => player.name)).toEqual([
        "ホスト",
        "ゲスト",
      ]);

      let hostSnapshot = hostJoinedSnapshot;
      let guestSnapshot = guestSession.snapshot;
      let version = hostSnapshot.version;
      let reconnectVerified = false;
      let actions = 0;

      while (hostSnapshot.phase !== "gameEnd") {
        if (actions > 1_000) {
          throw new Error(
            "オンライン対局が1,000操作以内に終局しませんでした。",
          );
        }

        if (!reconnectVerified && version >= 2) {
          await guest.close();
          hostSnapshot = await host.waitForSnapshot(
            (snapshot) =>
              snapshot.version === version && !playerConnected(snapshot, "p1"),
          );
          expect(hostSnapshot.phase).toBe("playing");

          const resumedGuest = new OnlineTestClient(server.url);
          clients.push(resumedGuest);
          await resumedGuest.open();
          resumedGuest.send({
            type: "resume",
            code,
            token: guestSession.token,
          });
          const resumedSession = await resumedGuest.waitForSession();
          expect(resumedSession.snapshot.you).toBe("p1");
          expect(resumedSession.snapshot.version).toBe(version);
          guestSnapshot = await resumedGuest.waitForSnapshot(
            (snapshot) => snapshot.version === version,
          );
          hostSnapshot = await host.waitForSnapshot(
            (snapshot) =>
              snapshot.version === version && playerConnected(snapshot, "p1"),
          );
          expect(hostSnapshot.phase).toBe(guestSnapshot.phase);
          reconnectVerified = true;
          clients.push(resumedGuest);
          // 以降は再接続後のクライアントをguestとして扱う。
          guest = resumedGuest;
        }

        const actorSnapshot =
          hostSnapshot.phase === "roundEnd"
            ? hostSnapshot
            : hostSnapshot.pending?.playerId === hostSnapshot.you
              ? hostSnapshot
              : guestSnapshot.pending?.playerId === guestSnapshot.you
                ? guestSnapshot
                : null;
        if (actorSnapshot === null) {
          throw new Error(
            "2クライアントのどちらにも操作担当pendingがありません。",
          );
        }
        const actor = actorSnapshot.you === "p0" ? host : guest;
        const action =
          hostSnapshot.phase === "roundEnd"
            ? { type: "nextRound" }
            : actionFor(actorSnapshot);
        const [nextHostSnapshot, nextGuestSnapshot] = await advanceVersion(
          [host, guest],
          version,
          actor,
          action,
        );
        hostSnapshot = nextHostSnapshot;
        guestSnapshot = nextGuestSnapshot;
        version = nextHostSnapshot.version;
        actions += 1;
      }

      expect(reconnectVerified).toBe(true);
      expect(hostSnapshot.phase).toBe("gameEnd");
      expect(guestSnapshot.phase).toBe("gameEnd");
      expect(hostSnapshot.view.result).not.toBeNull();
      expect(guestSnapshot.view.result).toEqual(hostSnapshot.view.result);
      const result = hostSnapshot.view.result;
      if (result === null) throw new Error("終局結果がありません。");
      expect(result.players).toHaveLength(4);
      expect(new Set(result.players.map((player) => player.rank)).size).toBe(4);
    },
    TEST_TIMEOUT_MS,
  );
});
