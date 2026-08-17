import { type ChildProcess, spawn } from "node:child_process";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type {
  OnlineRateLimitScope,
  OnlineServerMessage,
  OnlineSnapshot,
} from "../src/components/online/types";
import {
  ROOM_CODE_FORMAT_MESSAGE,
  ROOM_CODE_PATTERN,
} from "../src/lib/roomCode";
import { ABUSE_LIMITS } from "./abuseControl";
import { ONLINE_HANDSHAKE_TIMEOUT_MS } from "./handshake";

/**
 * server配下の test/spec ファイルは既存の Vitest unit project が収集する。
 * 本番WebSocketやPlaywrightを使わず、ローカルserver:startだけをfixture内で起動する。
 */
const TEST_ORIGIN = "http://online-e2e.local";
const UNAUTHORIZED_ORIGIN = "http://unauthorized-online-e2e.local";
const TEST_TIMEOUT_MS = 30_000;
const SERVER_START_TIMEOUT_MS = 10_000;
const SERVER_STOP_TIMEOUT_MS = 2_000;
// The full-game fixture intentionally runs much faster than a human. Keep its
// per-socket action stream below the production abuse window instead of making
// this regression test fail by design.
const LOCAL_ACTION_PACING_MS = Math.ceil(
  ABUSE_LIMITS.actions.windowMs / (ABUSE_LIMITS.actions.limit - 1),
);

type ProtocolMessage = OnlineServerMessage;
type RateLimitedScope = Exclude<OnlineRateLimitScope, "connection">;

interface LocalOnlineServer {
  readonly child: ChildProcess;
  readonly url: string;
}

interface UpgradeResponse {
  readonly statusCode: number | undefined;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

function childExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (childExited(child)) return;
  await new Promise<void>((resolve) => {
    let finished = false;
    const forceTimer: { id?: ReturnType<typeof setTimeout> } = {};
    const finish = () => {
      if (finished) return;
      finished = true;
      if (forceTimer.id !== undefined) clearTimeout(forceTimer.id);
      child.removeListener("exit", finish);
      resolve();
    };

    child.once("exit", finish);
    if (childExited(child)) {
      child.removeListener("exit", finish);
      resolve();
      return;
    }
    forceTimer.id = setTimeout(() => {
      if (!childExited(child)) child.kill("SIGKILL");
      // SIGKILLでもexitイベントの到着を待つが、異常なchild実装で
      // イベントが来ない場合にafterAllを永久に塞がない。
      setTimeout(finish, 100);
    }, SERVER_STOP_TIMEOUT_MS);
    child.kill("SIGTERM");
  });
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

async function startLocalOnlineServer(
  allowedOrigins = TEST_ORIGIN,
): Promise<LocalOnlineServer> {
  const port = await freePort();
  const output: string[] = [];
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(pnpm, ["server:start"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ALLOWED_ORIGINS: allowedOrigins,
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
    await terminateChild(child);
    throw error;
  }
  return { child, url };
}

async function stopLocalOnlineServer(server: LocalOnlineServer): Promise<void> {
  await terminateChild(server.child);
}

/** Send a real HTTP upgrade request so rejected handshakes expose status/headers. */
async function requestUpgrade(
  url: string,
  origin: string,
): Promise<UpgradeResponse> {
  const target = new URL(`${url}/ws`);
  return new Promise<UpgradeResponse>((resolve, reject) => {
    let settled = false;
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        Origin: origin,
        "Sec-WebSocket-Key": Buffer.from("four-bros-mahjon").toString("base64"),
        "Sec-WebSocket-Version": "13",
      },
    });
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.once("response", (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.once("end", () => {
        if (settled) return;
        settled = true;
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    request.once("upgrade", (_response, socket) => {
      socket.destroy();
      fail(new Error("upgrade request was unexpectedly accepted"));
    });
    request.once("error", fail);
    request.end();
  });
}

type MessagePredicate = (message: ProtocolMessage) => boolean;

class OnlineTestClient {
  private readonly socket: WebSocket;
  private closeRequested = false;
  private readonly closePromise: Promise<{
    readonly code: number;
    readonly reason: string;
  }>;
  private resolveClose!: (details: {
    readonly code: number;
    readonly reason: string;
  }) => void;
  private readonly queue: ProtocolMessage[] = [];
  private readonly waiters: Array<{
    readonly predicate: MessagePredicate;
    readonly resolve: (message: ProtocolMessage) => void;
    readonly reject: (error: Error) => void;
    readonly timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(
    readonly url: string,
    origin?: string,
  ) {
    this.closePromise = new Promise((resolve) => {
      this.resolveClose = resolve;
    });
    this.socket =
      origin === undefined
        ? new WebSocket(`${url}/ws`)
        : new WebSocket(`${url}/ws`, { origin });
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
    this.socket.on("close", (code, reason) => {
      const details = { code, reason: reason.toString() };
      this.resolveClose(details);
      if (!this.closeRequested) {
        this.rejectAll(
          new Error(
            `オンラインWebSocketが予期せず切断されました(code=${code}, reason=${details.reason})。`,
          ),
        );
      }
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

  async waitForError(): Promise<Extract<ProtocolMessage, { type: "error" }>> {
    return this.waitFor(
      (message): message is Extract<ProtocolMessage, { type: "error" }> =>
        message.type === "error",
    );
  }

  async waitForPong(): Promise<Extract<ProtocolMessage, { type: "pong" }>> {
    return this.waitFor(
      (message): message is Extract<ProtocolMessage, { type: "pong" }> =>
        message.type === "pong",
    );
  }

  async waitForRateLimit(
    scope: RateLimitedScope,
  ): Promise<Extract<ProtocolMessage, { type: "error" }>> {
    return this.waitFor(
      (message): message is Extract<ProtocolMessage, { type: "error" }> =>
        message.type === "error" &&
        message.code === "rate_limited" &&
        message.scope === scope,
    );
  }

  async waitForClose(
    timeoutMs = TEST_TIMEOUT_MS,
  ): Promise<{ readonly code: number; readonly reason: string }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error("オンラインWebSocketのcloseを受信できませんでした。"));
      }, timeoutMs);
    });
    try {
      return await Promise.race([this.closePromise, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
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
    this.closeRequested = true;
    this.rejectAll(new Error("オンラインWebSocketを閉じました。"));
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.socket.removeListener("close", finish);
        resolve();
      };
      this.socket.once("close", finish);
      if (this.socket.readyState === WebSocket.CLOSED) {
        finish();
        return;
      }
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
  await delay(LOCAL_ACTION_PACING_MS);
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

  it("rejects omitted room-code characters before room lookup", async () => {
    if (server === undefined)
      throw new Error("テストサーバーが起動していません。");
    const client = new OnlineTestClient(server.url, TEST_ORIGIN);
    clients.push(client);
    await client.open();

    client.send({ type: "join", code: "abci01", name: "ゲスト" });
    await expect(client.waitForError()).resolves.toMatchObject({
      message: ROOM_CODE_FORMAT_MESSAGE,
    });
    await client.close();
  });

  it(
    "2クライアントで作成・参加・開始・同期操作・結果・resume/reconnectを完走する",
    async () => {
      if (server === undefined)
        throw new Error("テストサーバーが起動していません。");
      const host = new OnlineTestClient(server.url, TEST_ORIGIN);
      let guest = new OnlineTestClient(server.url, TEST_ORIGIN);
      clients.push(host, guest);
      await Promise.all([host.open(), guest.open()]);

      host.send({ type: "create", name: "ホスト" });
      const hostSession = await host.waitForSession();
      const code = hostSession.snapshot.code;
      expect(ROOM_CODE_PATTERN.test(code)).toBe(true);
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

          const resumedGuest = new OnlineTestClient(server.url, TEST_ORIGIN);
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

  it(
    "空のOrigin allowlistではOriginなし・明示Originをfail-closedで拒否する",
    async () => {
      let developmentServer: LocalOnlineServer | undefined;
      let missingOrigin: OnlineTestClient | undefined;
      let explicitOrigin: OnlineTestClient | undefined;
      try {
        developmentServer = await startLocalOnlineServer("");
        missingOrigin = new OnlineTestClient(developmentServer.url);
        await expect(missingOrigin.open()).rejects.toThrow(
          "Unexpected server response: 403",
        );

        explicitOrigin = new OnlineTestClient(
          developmentServer.url,
          TEST_ORIGIN,
        );
        await expect(explicitOrigin.open()).rejects.toThrow(
          "Unexpected server response: 403",
        );
      } finally {
        if (missingOrigin !== undefined) await missingOrigin.close();
        if (explicitOrigin !== undefined) await explicitOrigin.close();
        if (developmentServer !== undefined)
          await stopLocalOnlineServer(developmentServer);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "Originなし・禁止Originとstale versionをサーバー境界で拒否する",
    async () => {
      if (server === undefined)
        throw new Error("テストサーバーが起動していません。");

      const missingOrigin = new OnlineTestClient(server.url, undefined);
      await expect(missingOrigin.open()).rejects.toThrow(
        "Unexpected server response: 403",
      );
      await missingOrigin.close();

      const unauthorized = new OnlineTestClient(
        server.url,
        UNAUTHORIZED_ORIGIN,
      );
      await expect(unauthorized.open()).rejects.toThrow(
        "Unexpected server response: 403",
      );
      await unauthorized.close();

      const client = new OnlineTestClient(server.url, TEST_ORIGIN);
      clients.push(client);
      await client.open();
      client.send({ type: "create", name: "stale検証" });
      const session = await client.waitForSession();
      const version = session.snapshot.version;

      client.send({
        type: "action",
        version: version + 1,
        action: { type: "tsumogiri" },
      });
      const error = await client.waitForError();
      expect(error.message).toContain("対局状態が更新されています");
      const snapshot = await client.waitForSnapshot(
        (candidate) => candidate.version === version,
      );
      expect(snapshot.version).toBe(version);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "keeps an idle seat alive through the application ping/pong contract",
    async () => {
      if (server === undefined)
        throw new Error("オンラインサーバーが起動していません。");

      const client = new OnlineTestClient(server.url, TEST_ORIGIN);
      clients.push(client);
      await client.open();
      client.send({ type: "create", name: "keepalive検証" });
      const session = await client.waitForSession();

      client.send({ type: "ping" });
      await expect(client.waitForPong()).resolves.toEqual({ type: "pong" });

      client.send({
        type: "action",
        version: session.snapshot.version + 1,
        action: { type: "tsumogiri" },
      });
      await expect(client.waitForError()).resolves.toMatchObject({
        type: "error",
        message: "対局状態が更新されています。最新状態を受信しました。",
      });
      await expect(
        client.waitForSnapshot(
          (snapshot) => snapshot.version === session.snapshot.version,
        ),
      ).resolves.toMatchObject({
        version: session.snapshot.version,
        players: [{ id: "p0", connected: true }],
      });
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "メッセージ過多を安定した再試行可能エラーで拒否し、接続を閉じる",
    async () => {
      if (server === undefined)
        throw new Error("オンラインサーバーが起動していません。");

      const client = new OnlineTestClient(server.url, TEST_ORIGIN);
      clients.push(client);
      await client.open();
      for (let index = 0; index <= ABUSE_LIMITS.messages.limit; index += 1) {
        client.send({ type: "ping" });
      }

      const error = await client.waitForError();
      expect(error).toMatchObject({
        type: "error",
        code: "rate_limited",
        scope: "message",
      });
      expect(error.retryAfterMs).toBeGreaterThan(0);
      await client.close();
    },
    TEST_TIMEOUT_MS,
  );
});

describe("online reconnect replacement race (#658)", () => {
  let server: LocalOnlineServer | undefined;
  const clients: OnlineTestClient[] = [];

  beforeAll(async () => {
    server = await startLocalOnlineServer();
  }, SERVER_START_TIMEOUT_MS + 5_000);

  afterAll(async () => {
    await closeTestClients(clients);
    if (server !== undefined) await stopLocalOnlineServer(server);
  });

  it(
    "keeps a resumed seat connected when it replaces an open socket",
    async () => {
      if (server === undefined)
        throw new Error("オンラインサーバーが起動していません。");

      const host = new OnlineTestClient(server.url, TEST_ORIGIN);
      const guest = new OnlineTestClient(server.url, TEST_ORIGIN);
      const resumedGuest = new OnlineTestClient(server.url, TEST_ORIGIN);
      clients.push(host, guest, resumedGuest);
      await Promise.all([host.open(), guest.open(), resumedGuest.open()]);

      host.send({ type: "create", name: "ホスト" });
      const hostSession = await host.waitForSession();
      const code = hostSession.snapshot.code;

      guest.send({ type: "join", code, name: "ゲスト" });
      const guestSession = await guest.waitForSession();
      const hostJoinedSnapshot = await host.waitForSnapshot(
        (snapshot) =>
          snapshot.version === 0 &&
          snapshot.players.length === 2 &&
          playerConnected(snapshot, "p1"),
      );

      resumedGuest.send({
        type: "resume",
        code,
        token: guestSession.token,
      });
      const resumedSession = await resumedGuest.waitForSession();
      expect(resumedSession.snapshot.you).toBe("p1");
      expect(resumedSession.snapshot.version).toBe(hostJoinedSnapshot.version);
      await Promise.all([
        host.waitForSnapshot(
          (snapshot) =>
            snapshot.version === hostJoinedSnapshot.version &&
            playerConnected(snapshot, "p1"),
        ),
        resumedGuest.waitForSnapshot(
          (snapshot) => snapshot.version === hostJoinedSnapshot.version,
        ),
      ]);

      await expect(guest.waitForClose()).resolves.toEqual({
        code: 4001,
        reason: "reconnected",
      });

      // Force a fresh server snapshot after the old close handler has run.
      // A stale version is rejected without changing the game state, while
      // sendError still returns the authoritative connection state.
      host.send({
        type: "action",
        version: hostJoinedSnapshot.version + 1,
        action: { type: "tsumogiri" },
      });
      await expect(host.waitForError()).resolves.toMatchObject({
        type: "error",
        message: "対局状態が更新されています。最新状態を受信しました。",
      });
      await expect(
        host.waitForSnapshot(
          (snapshot) =>
            snapshot.version === hostJoinedSnapshot.version &&
            playerConnected(snapshot, "p1"),
        ),
      ).resolves.toMatchObject({
        version: hostJoinedSnapshot.version,
        phase: "playing",
      });
    },
    TEST_TIMEOUT_MS,
  );
});

async function closeTestClients(
  clients: readonly OnlineTestClient[],
): Promise<void> {
  await Promise.allSettled(clients.map((client) => client.close()));
}

async function expectRateLimited(
  client: OnlineTestClient,
  scope: RateLimitedScope,
): Promise<void> {
  const error = await client.waitForRateLimit(scope);
  expect(error).toMatchObject({
    type: "error",
    code: "rate_limited",
    scope,
  });
  expect(error.retryAfterMs ?? 0).toBeGreaterThan(0);
  const close = await client.waitForClose();
  expect(close).toEqual({ code: 1013, reason: "rate limited" });
}

describe("online abuse boundary and four-client regression (#651)", () => {
  it(
    "実WebSocket upgrade拒否でHTTP status・Retry-After・JSON詳細を返す",
    async () => {
      let server: LocalOnlineServer | undefined;
      const clients: OnlineTestClient[] = [];
      try {
        server = await startLocalOnlineServer();
        for (
          let index = 0;
          index < ABUSE_LIMITS.maxConnectionsPerSource;
          index += 1
        ) {
          clients.push(new OnlineTestClient(server.url, TEST_ORIGIN));
        }
        await Promise.all(clients.map((client) => client.open()));

        const response = await requestUpgrade(server.url, TEST_ORIGIN);
        expect(response.statusCode).toBe(503);
        expect(response.headers["retry-after"]).toBe(
          String(Math.ceil(ABUSE_LIMITS.connectionRetryAfterMs / 1_000)),
        );
        expect(JSON.parse(response.body)).toMatchObject({
          ok: false,
          code: "connection_limit",
          retryAfterMs: ABUSE_LIMITS.connectionRetryAfterMs,
        });
      } finally {
        await closeTestClients(clients);
        if (server !== undefined) await stopLocalOnlineServer(server);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "handshake未完了の接続を解放し、後続ユーザーの接続枠を回復する",
    async () => {
      let server: LocalOnlineServer | undefined;
      const clients: OnlineTestClient[] = [];
      try {
        const onlineServer = await startLocalOnlineServer();
        server = onlineServer;
        const idleClients = Array.from(
          { length: ABUSE_LIMITS.maxConnectionsPerSource },
          () => new OnlineTestClient(onlineServer.url, TEST_ORIGIN),
        );
        clients.push(...idleClients);
        await Promise.all(idleClients.map((client) => client.open()));

        const rejected = await requestUpgrade(onlineServer.url, TEST_ORIGIN);
        expect(rejected.statusCode).toBe(503);
        expect(JSON.parse(rejected.body)).toMatchObject({
          ok: false,
          code: "connection_limit",
        });

        const close = await idleClients[0].waitForClose(
          ONLINE_HANDSHAKE_TIMEOUT_MS + 5_000,
        );
        expect(close.code).not.toBe(1000);

        const recovered = new OnlineTestClient(onlineServer.url, TEST_ORIGIN);
        clients.push(recovered);
        await recovered.open();
        recovered.send({ type: "create", name: "タイムアウト後ホスト" });
        await expect(recovered.waitForSession()).resolves.toMatchObject({
          type: "session",
        });

        await delay(ONLINE_HANDSHAKE_TIMEOUT_MS + 250);
        recovered.send({ type: "ping" });
        await recovered.waitForPong();
      } finally {
        await closeTestClients(clients);
        if (server !== undefined) await stopLocalOnlineServer(server);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "create・join・resume・actionの制限を実通信で検証し、1013 close詳細を保持する",
    async () => {
      let server: LocalOnlineServer | undefined;
      const clients: OnlineTestClient[] = [];
      try {
        server = await startLocalOnlineServer();

        const createClient = new OnlineTestClient(server.url, TEST_ORIGIN);
        clients.push(createClient);
        await createClient.open();
        for (
          let index = 0;
          index <= ABUSE_LIMITS.roomAttempts.create.limit;
          index += 1
        ) {
          createClient.send({ type: "create", name: "作成制限検証" });
        }
        await expectRateLimited(createClient, "create");

        const joinClient = new OnlineTestClient(server.url, TEST_ORIGIN);
        clients.push(joinClient);
        await joinClient.open();
        for (
          let index = 0;
          index <= ABUSE_LIMITS.roomAttempts.join.limit;
          index += 1
        ) {
          joinClient.send({
            type: "join",
            code: "ZZZZZZ",
            name: "参加制限検証",
          });
        }
        await expectRateLimited(joinClient, "join");

        const resumeClient = new OnlineTestClient(server.url, TEST_ORIGIN);
        clients.push(resumeClient);
        await resumeClient.open();
        for (
          let index = 0;
          index <= ABUSE_LIMITS.roomAttempts.resume.limit;
          index += 1
        ) {
          resumeClient.send({
            type: "resume",
            code: "ZZZZZZ",
            token: "invalid-token",
          });
        }
        await expectRateLimited(resumeClient, "resume");

        const actionClient = new OnlineTestClient(server.url, TEST_ORIGIN);
        clients.push(actionClient);
        await actionClient.open();
        for (let index = 0; index <= ABUSE_LIMITS.actions.limit; index += 1) {
          actionClient.send({ type: "newGame" });
        }
        await expectRateLimited(actionClient, "action");
      } finally {
        await closeTestClients(clients);
        if (server !== undefined) await stopLocalOnlineServer(server);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "4クライアントで作成・3人参加・同期操作を実通信で完走する",
    async () => {
      let server: LocalOnlineServer | undefined;
      const clients: OnlineTestClient[] = [];
      try {
        server = await startLocalOnlineServer();
        const host = new OnlineTestClient(server.url, TEST_ORIGIN);
        const guests = [
          new OnlineTestClient(server.url, TEST_ORIGIN),
          new OnlineTestClient(server.url, TEST_ORIGIN),
          new OnlineTestClient(server.url, TEST_ORIGIN),
        ];
        clients.push(host, ...guests);
        await Promise.all(clients.map((client) => client.open()));

        host.send({ type: "create", name: "4人ホスト" });
        const hostSession = await host.waitForSession();
        const code = hostSession.snapshot.code;
        await Promise.all(
          guests.map(async (guest, index) => {
            guest.send({
              type: "join",
              code: code.toLowerCase(),
              name: `4人ゲスト${index + 1}`,
            });
            await guest.waitForSession();
          }),
        );

        const connectedSnapshots = await Promise.all(
          clients.map((client) =>
            client.waitForSnapshot(
              (snapshot) =>
                snapshot.version === 0 &&
                snapshot.players.length === 4 &&
                snapshot.players.every((player) => player.connected),
            ),
          ),
        );
        expect(
          connectedSnapshots[0]?.players.map((player) => player.id),
        ).toEqual(["p0", "p1", "p2", "p3"]);
        expect(connectedSnapshots.map((snapshot) => snapshot.version)).toEqual([
          0, 0, 0, 0,
        ]);

        const actorIndex = connectedSnapshots.findIndex(
          (snapshot) => snapshot.pending?.playerId === snapshot.you,
        );
        if (actorIndex < 0) {
          throw new Error("4クライアントのいずれにも操作担当がいません。");
        }
        const actorSnapshot = connectedSnapshots[actorIndex];
        clients[actorIndex]?.send({
          type: "action",
          version: actorSnapshot.version,
          action: actionFor(actorSnapshot),
        });

        const nextSnapshots = await Promise.all(
          clients.map((client) =>
            client.waitForSnapshot((snapshot) => snapshot.version === 1),
          ),
        );
        expect(nextSnapshots.map((snapshot) => snapshot.version)).toEqual([
          1, 1, 1, 1,
        ]);
        for (const snapshot of nextSnapshots) {
          expect(snapshot.players).toHaveLength(4);
          expect(snapshot.players.every((player) => player.connected)).toBe(
            true,
          );
          expect(snapshot.currentTurn).toBe(nextSnapshots[0]?.currentTurn);
        }
      } finally {
        await closeTestClients(clients);
        if (server !== undefined) await stopLocalOnlineServer(server);
      }
    },
    TEST_TIMEOUT_MS,
  );
});

describe("online host handoff (#681)", () => {
  it(
    "network disconnect transfers host authority and lets the guest continue the current turn",
    async () => {
      let server: LocalOnlineServer | undefined;
      const clients: OnlineTestClient[] = [];
      try {
        server = await startLocalOnlineServer();
        const host = new OnlineTestClient(server.url, TEST_ORIGIN);
        const guest = new OnlineTestClient(server.url, TEST_ORIGIN);
        clients.push(host, guest);
        await Promise.all([host.open(), guest.open()]);

        host.send({ type: "create", name: "ホスト" });
        const hostSession = await host.waitForSession();
        const code = hostSession.snapshot.code;
        guest.send({ type: "join", code, name: "ゲスト" });
        await guest.waitForSession();
        await host.waitForSnapshot((snapshot) => snapshot.players.length === 2);

        await host.close();
        const handoff = await guest.waitForSnapshot(
          (snapshot) =>
            snapshot.hostId === "p1" &&
            snapshot.players.find((player) => player.id === "p0")?.connected ===
              false,
        );
        expect(
          handoff.players.find((player) => player.id === "p1")?.isHost,
        ).toBe(true);
        expect(handoff.hostNotice).toMatchObject({ reason: "disconnected" });
        expect(handoff.pending?.playerId).toBe("p1");

        guest.send({
          type: "action",
          version: handoff.version,
          action: actionFor(handoff),
        });
        await expect(
          guest.waitForSnapshot(
            (snapshot) => snapshot.version === handoff.version + 1,
          ),
        ).resolves.toMatchObject({ hostId: "p1" });
      } finally {
        await closeTestClients(clients);
        if (server !== undefined) await stopLocalOnlineServer(server);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "explicit host leave transfers authority and invalidates the old resume token",
    async () => {
      let server: LocalOnlineServer | undefined;
      const clients: OnlineTestClient[] = [];
      try {
        server = await startLocalOnlineServer();
        const host = new OnlineTestClient(server.url, TEST_ORIGIN);
        const guest = new OnlineTestClient(server.url, TEST_ORIGIN);
        clients.push(host, guest);
        await Promise.all([host.open(), guest.open()]);

        host.send({ type: "create", name: "退出ホスト" });
        const session = await host.waitForSession();
        const code = session.snapshot.code;
        const token = session.token;
        guest.send({ type: "join", code, name: "引継ぎゲスト" });
        await guest.waitForSession();
        await host.waitForSnapshot((snapshot) => snapshot.players.length === 2);

        host.send({ type: "leave" });
        const handoff = await guest.waitForSnapshot(
          (snapshot) =>
            snapshot.hostId === "p1" && snapshot.hostNotice?.reason === "left",
        );
        expect(
          handoff.players.find((player) => player.id === "p0"),
        ).toMatchObject({
          connected: false,
          isHost: false,
        });

        const stale = new OnlineTestClient(server.url, TEST_ORIGIN);
        clients.push(stale);
        await stale.open();
        stale.send({ type: "resume", code, token });
        await expect(stale.waitForError()).resolves.toMatchObject({
          message: "再接続情報が無効か、ルームの有効期限が切れています。",
        });
      } finally {
        await closeTestClients(clients);
        if (server !== undefined) await stopLocalOnlineServer(server);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "explicit guest leave releases its pending seat, keeps host authority, and invalidates the old token",
    async () => {
      let server: LocalOnlineServer | undefined;
      const clients: OnlineTestClient[] = [];
      try {
        server = await startLocalOnlineServer();
        const host = new OnlineTestClient(server.url, TEST_ORIGIN);
        const guest = new OnlineTestClient(server.url, TEST_ORIGIN);
        clients.push(host, guest);
        await Promise.all([host.open(), guest.open()]);

        host.send({ type: "create", name: "ホスト" });
        const session = await host.waitForSession();
        const code = session.snapshot.code;
        guest.send({ type: "join", code, name: "退出ゲスト" });
        const guestSession = await guest.waitForSession();
        await host.waitForSnapshot((snapshot) => snapshot.players.length === 2);

        const hostSnapshot = await host.waitForSnapshot(
          (snapshot) => snapshot.pending?.playerId === "p0",
        );
        host.send({
          type: "action",
          version: hostSnapshot.version,
          action: actionFor(hostSnapshot),
        });
        const guestTurn = await guest.waitForSnapshot(
          (snapshot) => snapshot.pending?.playerId === "p1",
        );

        guest.send({ type: "leave" });
        const released = await host.waitForSnapshot(
          (snapshot) =>
            snapshot.version > guestTurn.version &&
            snapshot.departureNotice?.playerId === "p1",
        );
        expect(released.hostId).toBe("p0");
        expect(released.pending?.playerId).not.toBe("p1");
        expect(released.departureNotice).toMatchObject({
          playerName: "退出ゲスト",
        });
        expect(
          released.players.find((player) => player.id === "p1"),
        ).toMatchObject({ connected: false, isHost: false });

        const stale = new OnlineTestClient(server.url, TEST_ORIGIN);
        clients.push(stale);
        await stale.open();
        stale.send({ type: "resume", code, token: guestSession.token });
        await expect(stale.waitForError()).resolves.toMatchObject({
          message: "再接続情報が無効か、ルームの有効期限が切れています。",
        });

        const rejoined = new OnlineTestClient(server.url, TEST_ORIGIN);
        clients.push(rejoined);
        await rejoined.open();
        rejoined.send({ type: "join", code, name: "再参加ゲスト" });
        const rejoinedSession = await rejoined.waitForSession();
        expect(rejoinedSession).toMatchObject({
          snapshot: { you: "p1", hostId: "p0" },
        });

        let activeGuest = rejoined;
        let activeSession = rejoinedSession;
        for (const name of ["再参加ゲスト2", "再参加ゲスト3"]) {
          activeGuest.send({ type: "leave" });
          await host.waitForSnapshot(
            (snapshot) =>
              snapshot.version > activeSession.snapshot.version &&
              snapshot.departureNotice?.playerId === "p1" &&
              snapshot.players.find((player) => player.id === "p1")
                ?.connected === false,
          );

          const nextGuest = new OnlineTestClient(server.url, TEST_ORIGIN);
          clients.push(nextGuest);
          await nextGuest.open();
          nextGuest.send({ type: "join", code, name });
          activeSession = await nextGuest.waitForSession();
          expect(activeSession.snapshot.you).toBe("p1");
          expect(activeSession.snapshot.hostId).toBe("p0");
          activeGuest = nextGuest;
        }
      } finally {
        await closeTestClients(clients);
        if (server !== undefined) await stopLocalOnlineServer(server);
      }
    },
    TEST_TIMEOUT_MS,
  );
});
