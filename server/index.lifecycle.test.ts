import { once } from "node:events";
import { createConnection } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { OnlineSnapshot } from "../src/domain/online/types";
import { ABUSE_LIMITS, OnlineAbuseControls } from "./abuseControl";
import { createOnlineServer } from "./index";

const ORIGIN = "http://shutdown.local";

function environment(notices: boolean): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "test",
    ALLOWED_ORIGINS: ORIGIN,
    ONLINE_OPS_REQUIRED: "false",
    ONLINE_OPS_TOKEN: "",
    ONLINE_SOURCE_REVISION: "",
    ONLINE_MAINTENANCE_NOTICES_ENABLED: String(notices),
    ONLINE_DRAIN_RECONNECT_GRACE_MS: "15000",
    ONLINE_SHUTDOWN_GRACE_MS: "1100",
    ONLINE_SOCKET_CLOSE_GRACE_MS: "1000",
  };
}

async function listen(server: ReturnType<typeof createOnlineServer>) {
  await server.listen(0, "127.0.0.1");
  const address = server.httpServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("test server did not expose a TCP address");
  }
  return address.port;
}

async function openWebSocket(
  port: number,
  headers: Record<string, string> = {},
): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    origin: ORIGIN,
    headers,
  });
  await once(socket, "open");
  return socket;
}

async function sendApplicationPings(
  socket: WebSocket,
  count: number,
): Promise<{ readonly pongs: number; readonly rateLimited: boolean }> {
  return new Promise((resolve, reject) => {
    let pongs = 0;
    let settled = false;
    const timer = setTimeout(
      () => finishReject(new Error("application ping responses timed out")),
      5_000,
    );
    const finish = (result: {
      readonly pongs: number;
      readonly rateLimited: boolean;
    }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(result);
    };
    const finishReject = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off("message", onMessage);
      reject(error);
    };
    const onMessage = (data: Buffer) => {
      const message = JSON.parse(data.toString()) as {
        readonly type?: string;
        readonly code?: string;
      };
      if (message.type === "pong") {
        pongs += 1;
        if (pongs === count) finish({ pongs, rateLimited: false });
      } else if (message.type === "error" && message.code === "rate_limited") {
        finish({ pongs, rateLimited: true });
      }
    };
    socket.on("message", onMessage);
    for (let index = 0; index < count; index += 1) {
      socket.send(JSON.stringify({ type: "ping" }));
    }
  });
}

function waitForMessage(
  socket: WebSocket,
  predicate: (value: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("expected WebSocket message was not received")),
      5_000,
    );
    socket.on("message", function onMessage(data) {
      const value = JSON.parse(data.toString()) as Record<string, unknown>;
      if (!predicate(value)) return;
      clearTimeout(timer);
      socket.off("message", onMessage);
      resolve(value);
    });
  });
}

function openRawUpgrade(
  port: number,
  origin = ORIGIN,
): {
  readonly socket: ReturnType<typeof createConnection>;
  readonly response: Promise<string>;
  readonly closed: Promise<void>;
} {
  const chunks: Buffer[] = [];
  const socket = createConnection(
    { host: "127.0.0.1", port, allowHalfOpen: true },
    () => {
      socket.write(
        "GET /ws HTTP/1.1\r\n" +
          `Host: 127.0.0.1:${port}\r\n` +
          "Connection: Upgrade\r\n" +
          "Upgrade: websocket\r\n" +
          `Origin: ${origin}\r\n` +
          `Sec-WebSocket-Key: ${Buffer.from("shutdown-pending").toString("base64")}\r\n` +
          "Sec-WebSocket-Version: 13\r\n\r\n",
      );
    },
  );
  socket.on("data", (chunk) =>
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
  );
  const response = new Promise<string>((resolve, reject) => {
    socket.once("error", reject);
    socket.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
  const closed = new Promise<void>((resolve) => socket.once("close", resolve));
  return { socket, response, closed };
}

describe("createOnlineServer lifecycle", () => {
  it("has no listen side effect and shuts down safely before first listen", async () => {
    const server = createOnlineServer({ environment: environment(false) });
    expect(server.httpServer.listening).toBe(false);
    await server.handleSignal("SIGTERM");
    expect(server.shutdownController.state()).toMatchObject({
      completed: true,
      firstSignal: "SIGTERM",
    });
    expect(server.httpServer.listening).toBe(false);
    await expect(server.listen(0, "127.0.0.1")).rejects.toThrow(/cannot start/);
  });

  it("linearizes a signal racing the first listen and leaves no bound port", async () => {
    const server = createOnlineServer({ environment: environment(false) });
    const listening = server.listen(0, "127.0.0.1");
    let listenSettled = false;
    void listening.then(
      () => (listenSettled = true),
      () => (listenSettled = true),
    );
    const shutdown = server.handleSignal("SIGINT");
    await shutdown;
    expect(listenSettled).toBe(true);
    expect(server.httpServer.listening).toBe(false);
    const [listenResult, shutdownResult] = await Promise.allSettled([
      listening,
      shutdown,
    ]);
    expect(listenResult.status).toBe("rejected");
    expect(shutdownResult.status).toBe("fulfilled");
    expect(server.httpServer.listening).toBe(false);
  });

  it("treats an already-closed WebSocketServer as idempotent cleanup", async () => {
    const server = createOnlineServer({ environment: environment(false) });
    await new Promise<void>((resolve) =>
      server.websocketServer.close(() => resolve()),
    );
    await expect(server.handleSignal("SIGTERM")).resolves.toBeUndefined();
    expect(server.shutdownController.state().completed).toBe(true);
  });

  it("settles startup state after a synchronous listen failure", async () => {
    const server = createOnlineServer({ environment: environment(false) });
    await expect(server.listen(-1, "127.0.0.1")).rejects.toThrow();
    await expect(server.handleSignal("SIGTERM")).resolves.toBeUndefined();
    expect(server.shutdownController.state()).toMatchObject({
      closing: true,
      completed: true,
    });
    expect(server.httpServer.listening).toBe(false);
  });

  it("reports not ready when the fail-closed Origin allowlist rejects every WebSocket", async () => {
    const server = createOnlineServer({
      environment: { ...environment(false), ALLOWED_ORIGINS: "" },
    });
    const port = await listen(server);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/readyz`);
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ ok: false });
    } finally {
      await server.handleSignal("SIGTERM");
    }
  });

  it("rejects public route methods and bodies before serving them", async () => {
    const server = createOnlineServer({ environment: environment(false) });
    const port = await listen(server);
    try {
      for (const path of ["/healthz", "/readyz", "/"] as const) {
        const response = await fetch(`http://127.0.0.1:${port}${path}`, {
          method: "POST",
        });
        expect(response.status, path).toBe(405);
        expect(response.headers.get("allow"), path).toBe("GET, HEAD, OPTIONS");
        await expect(response.json()).resolves.toEqual({
          ok: false,
          error: "method_not_allowed",
        });
      }

      const bodyResponse = await fetch(`http://127.0.0.1:${port}/healthz`, {
        method: "POST",
        body: "unexpected body",
      });
      expect(bodyResponse.status).toBe(400);
      await expect(bodyResponse.json()).resolves.toEqual({
        ok: false,
        error: "body_not_allowed",
      });
      expect(bodyResponse.headers.get("connection")).toBe("close");
    } finally {
      await server.handleSignal("SIGTERM");
    }
  });

  it("uses the injected Railway marker for per-source ops rate limiting", async () => {
    const token = "P".repeat(32);
    const server = createOnlineServer({
      environment: {
        ...environment(false),
        RAILWAY_ENVIRONMENT_ID: "test-railway",
        ONLINE_OPS_REQUIRED: "true",
        ONLINE_OPS_TOKEN: token,
        ONLINE_SOURCE_REVISION: "e".repeat(40),
      },
    });
    const port = await listen(server);
    try {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 11; attempt += 1) {
        const response = await fetch(`http://127.0.0.1:${port}/ops/status`, {
          headers: {
            authorization: `Bearer ${token}`,
            "x-real-ip": `203.0.113.${attempt + 1}`,
          },
        });
        statuses.push(response.status);
        await response.arrayBuffer();
      }

      expect(statuses).toEqual(Array.from({ length: 11 }, () => 200));
    } finally {
      await server.handleSignal("SIGTERM");
    }
  });

  it("rejects binary WebSocket messages before JSON parsing", async () => {
    const server = createOnlineServer({ environment: environment(false) });
    const port = await listen(server);
    const socket = await openWebSocket(port);
    try {
      const messages: unknown[] = [];
      socket.on("message", (data) =>
        messages.push(JSON.parse(data.toString())),
      );
      const closed = new Promise<{
        readonly code: number;
        readonly reason: string;
      }>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("binary WebSocket was not rejected")),
          1_000,
        );
        socket.once("close", (code, reason) => {
          clearTimeout(timer);
          resolve({ code, reason: reason.toString() });
        });
      });

      socket.send(
        Buffer.from(JSON.stringify({ type: "create", name: "binary" })),
      );

      await expect(closed).resolves.toEqual({
        code: 1003,
        reason: "unsupported data",
      });
      expect(messages).toEqual([]);
    } finally {
      if (socket.readyState !== WebSocket.CLOSED) {
        const closed = once(socket, "close");
        socket.terminate();
        await closed;
      }
      await server.handleSignal("SIGTERM");
    }
  });

  it("ignores buffered actions after a binary protocol violation", async () => {
    const server = createOnlineServer({ environment: environment(false) });
    const port = await listen(server);
    const host = await openWebSocket(port);
    const guest = await openWebSocket(port);
    try {
      const sessionPromise = waitForMessage(
        host,
        (value) => value.type === "session",
      );
      host.send(JSON.stringify({ type: "create", name: "buffer-test-host" }));
      const session = await sessionPromise;
      const snapshot = session.snapshot as OnlineSnapshot;
      const self = snapshot.view.slots.self;
      if (self.kind !== "seated" || self.player.hand === undefined) {
        throw new Error("test host hand is missing");
      }
      const tile = self.player.hand[0];

      const initialSnapshotPromise = waitForMessage(
        guest,
        (value) => value.type === "snapshot",
      );
      guest.send(
        JSON.stringify({
          type: "join",
          code: snapshot.code,
          name: "buffer-test-guest",
        }),
      );
      await initialSnapshotPromise;

      const closed = once(host, "close");
      const nextSnapshot = waitForMessage(
        guest,
        (value) =>
          value.type === "snapshot" &&
          (value.snapshot as OnlineSnapshot).version === snapshot.version + 1,
      );
      // ws can deliver both frames from one receive buffer before the close
      // callback runs. The second frame must not mutate the room after the
      // binary protocol violation has revoked this peer's authority.
      host.send(
        Buffer.from(JSON.stringify({ type: "create", name: "binary" })),
      );
      host.send(
        JSON.stringify({
          type: "action",
          version: snapshot.version,
          action: { type: "discard", tile },
        }),
      );

      await closed;
      expect((await nextSnapshot).snapshot as OnlineSnapshot).toMatchObject({
        players: expect.arrayContaining([
          expect.objectContaining({ id: "p0", connected: false }),
        ]),
      });
    } finally {
      for (const socket of [host, guest]) {
        if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
      }
      await server.handleSignal("SIGTERM");
    }
  });

  it("uses the injected Railway marker for WebSocket source rate limiting", async () => {
    const previousMarker = process.env.RAILWAY_ENVIRONMENT_ID;
    delete process.env.RAILWAY_ENVIRONMENT_ID;
    const server = createOnlineServer({
      environment: {
        ...environment(false),
        RAILWAY_ENVIRONMENT_ID: "injected-railway",
      },
    });
    const port = await listen(server);
    const sockets: WebSocket[] = [];
    try {
      for (
        let index = 0;
        index <= ABUSE_LIMITS.maxConnectionsPerSource;
        index += 1
      ) {
        sockets.push(
          await openWebSocket(port, {
            "X-Real-IP": `203.0.113.${index + 1}`,
          }),
        );
      }
      expect(sockets).toHaveLength(ABUSE_LIMITS.maxConnectionsPerSource + 1);

      const pingResults = await Promise.all(
        sockets.slice(0, 3).map((socket) => sendApplicationPings(socket, 201)),
      );
      expect(pingResults).toEqual(
        Array.from({ length: 3 }, () => ({
          pongs: 201,
          rateLimited: false,
        })),
      );
    } finally {
      await Promise.allSettled(
        sockets.map(
          (socket) =>
            new Promise<void>((resolve) => {
              if (socket.readyState === WebSocket.CLOSED) {
                resolve();
                return;
              }
              socket.once("close", () => resolve());
              socket.close();
            }),
        ),
      );
      await server.handleSignal("SIGTERM");
      if (previousMarker === undefined) {
        delete process.env.RAILWAY_ENVIRONMENT_ID;
      } else {
        process.env.RAILWAY_ENVIRONMENT_ID = previousMarker;
      }
    }
  });

  it("does not release a pending upgrade reservation when an established peer closes", async () => {
    const releasePendingUpgrade = vi.spyOn(
      OnlineAbuseControls.prototype,
      "releasePendingUpgrade",
    );
    const server = createOnlineServer({ environment: environment(false) });
    try {
      const port = await listen(server);
      const socket = await openWebSocket(port);
      const closed = once(socket, "close");
      socket.close();
      await closed;

      // The reservation is released exactly once during upgrade handoff. An
      // established socket owns no pending reservation and must not release a
      // different in-flight upgrade when it later closes.
      expect(releasePendingUpgrade).toHaveBeenCalledOnce();
    } finally {
      await server.handleSignal("SIGTERM");
      releasePendingUpgrade.mockRestore();
    }
  });

  it.each([
    { configuredOrigins: "*", handshakeOrigin: "*" },
    {
      configuredOrigins: "https://*.vercel.app",
      handshakeOrigin: "https://*.vercel.app",
    },
    { configuredOrigins: `${ORIGIN}/path`, handshakeOrigin: `${ORIGIN}/path` },
    { configuredOrigins: `${ORIGIN},*`, handshakeOrigin: ORIGIN },
    {
      configuredOrigins: `${ORIGIN},${ORIGIN}/path`,
      handshakeOrigin: ORIGIN,
    },
    { configuredOrigins: `${ORIGIN},`, handshakeOrigin: ORIGIN },
    { configuredOrigins: `,${ORIGIN}`, handshakeOrigin: ORIGIN },
    { configuredOrigins: `${ORIGIN},,${ORIGIN}`, handshakeOrigin: ORIGIN },
  ])(
    "reports not ready and rejects a non-canonical Origin allowlist: $configuredOrigins",
    async ({ configuredOrigins, handshakeOrigin }) => {
      const server = createOnlineServer({
        environment: {
          ...environment(false),
          ALLOWED_ORIGINS: configuredOrigins,
        },
      });
      const port = await listen(server);
      const upgrade = openRawUpgrade(port, handshakeOrigin);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/readyz`);
        expect(response.status).toBe(503);
        await expect(response.json()).resolves.toEqual({ ok: false });
        await expect(upgrade.response).resolves.toMatch(
          /^HTTP\/1\.1 403 Forbidden\r\n/,
        );
      } finally {
        upgrade.socket.destroy();
        await upgrade.closed;
        await server.handleSignal("SIGTERM");
      }
    },
  );

  it("sends one deadline-aware terminal notice, then closes with 1012", async () => {
    const server = createOnlineServer({ environment: environment(true) });
    const port = await listen(server);
    const socket = await openWebSocket(port);
    const messages: unknown[] = [];
    socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
    const closed = once(socket, "close");

    const shutdown = server.handleSignal("SIGTERM");
    const [code, reason] = (await closed) as [number, Buffer];
    await shutdown;
    expect(code).toBe(1012);
    expect(reason.toString()).toBe("service restart");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: "maintenance",
      phase: "terminating",
    });
    expect(
      new Date((messages[0] as { deadline: string }).deadline).toISOString(),
    ).toBe((messages[0] as { deadline: string }).deadline);
    expect(server.httpServer.listening).toBe(false);
  });

  it("keeps shutdown and 1012 active when additive notices are default-off", async () => {
    const server = createOnlineServer({ environment: environment(false) });
    const port = await listen(server);
    const socket = await openWebSocket(port);
    const messages: unknown[] = [];
    socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
    const closed = once(socket, "close");

    const shutdown = server.handleSignal("SIGTERM");
    const [code] = (await closed) as [number];
    await shutdown;
    expect(code).toBe(1012);
    expect(messages).toEqual([]);
  });

  it("falls back to an exact deadline-free notice for an incompatible wall year", async () => {
    const server = createOnlineServer({
      environment: environment(true),
      wallNow: () => Date.UTC(10_000, 0, 1) - 500,
    });
    const port = await listen(server);
    const socket = await openWebSocket(port);
    const message = waitForMessage(
      socket,
      (value) => value.type === "maintenance" && value.phase === "terminating",
    );
    const closed = once(socket, "close");
    const shutdown = server.handleSignal("SIGTERM");
    await expect(message).resolves.toEqual({
      type: "maintenance",
      phase: "terminating",
    });
    await closed;
    await shutdown;
  });

  it("releases an in-flight upgrade before handoff and keeps it force-trackable", async () => {
    const token = "P".repeat(32);
    const server = createOnlineServer({
      environment: {
        ...environment(true),
        ONLINE_OPS_REQUIRED: "true",
        ONLINE_OPS_TOKEN: token,
        ONLINE_SOURCE_REVISION: "e".repeat(40),
        ONLINE_SHUTDOWN_GRACE_MS: "5000",
        ONLINE_SOCKET_CLOSE_GRACE_MS: "1000",
      },
    });
    const port = await listen(server);
    const host = await openWebSocket(port);
    const session = waitForMessage(host, (value) => value.type === "session");
    host.send(JSON.stringify({ type: "create", name: "pending保持" }));
    await session;

    // Hold handleUpgrade after the admission reservation to create a stable
    // in-flight boundary. Shutdown must revoke it before any client handoff.
    let delayedHandoff:
      | Parameters<typeof server.websocketServer.handleUpgrade>[3]
      | null = null;
    let heldServerSocket:
      | Parameters<typeof server.websocketServer.handleUpgrade>[1]
      | null = null;
    const holdUpgrade: typeof server.websocketServer.handleUpgrade = (
      _request,
      _socket,
      _head,
      callback,
    ) => {
      heldServerSocket = _socket;
      delayedHandoff = callback;
    };
    server.websocketServer.handleUpgrade = holdUpgrade;
    const raw = openRawUpgrade(port);
    const headers = { authorization: `Bearer ${token}` };
    const waitForPending = async () => {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const response = await fetch(`http://127.0.0.1:${port}/ops/status`, {
          headers,
        });
        const body = (await response.json()) as {
          aggregate: { pendingUpgrades: number };
        };
        if (body.aggregate.pendingUpgrades === 1) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("upgrade reservation was not observed");
    };
    await waitForPending();

    const terminating = waitForMessage(
      host,
      (value) => value.type === "maintenance" && value.phase === "terminating",
    );
    const shutdown = server.handleSignal("SIGTERM");
    let shutdownSettled = false;
    void shutdown.then(() => (shutdownSettled = true));
    const terminatingNotice = await terminating;
    const rejected = await raw.response;
    expect(rejected).toContain("HTTP/1.1 503 Service Unavailable");
    expect(rejected).toContain('"code":"maintenance"');
    expect(rejected).toContain("Cache-Control: no-store");
    expect(rejected).toContain("Connection: close");
    const statusResponse = await fetch(`http://127.0.0.1:${port}/ops/status`, {
      headers,
    });
    const status = (await statusResponse.json()) as Record<string, unknown>;
    expect(status).toMatchObject({
      phase: "terminating",
      aggregate: { pendingUpgrades: 0, webSocketConnections: 1 },
    });
    expect(status.drainStartedAt).toEqual(expect.stringMatching(/Z$/));
    expect(status.deadline).toBe(terminatingNotice.deadline);
    expect(shutdownSettled).toBe(false);

    const hostClosed = once(host, "close");
    server.handleSignal("SIGINT");
    await shutdown;
    await hostClosed;
    expect(
      (heldServerSocket as unknown as { readonly destroyed: boolean } | null)
        ?.destroyed,
    ).toBe(true);
    raw.socket.destroy();
    await raw.closed;
    const lateSocket = { terminate: vi.fn() } as unknown as WebSocket;
    (
      delayedHandoff as unknown as (
        websocket: WebSocket,
        request: unknown,
      ) => void
    )(lateSocket, {});
    expect(lateSocket.terminate).toHaveBeenCalledOnce();
    expect(server.httpServer.listening).toBe(false);
  });
});
