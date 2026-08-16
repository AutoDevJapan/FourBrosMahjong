import { createServer, type IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import type {
  OnlineErrorCode,
  OnlineRateLimitScope,
} from "../src/components/online/types";
import {
  type AbuseRejection,
  type ClientAbuseState,
  OnlineAbuseControls,
  type RoomAttemptScope,
} from "./abuseControl";
import {
  type ConnectionState,
  hasOpenPeer as hasOpenPeerConnection,
  registerReplacementBeforeClose,
} from "./connectionState";
import {
  normalizePlayerName,
  normalizeRoomCode,
  parseGameAction,
  RoomManager,
  type RoomPlayer,
  type RoomSession,
} from "./roomManager";

const PORT = Number(process.env.PORT ?? 8080);
const MAX_MESSAGE_BYTES = 32 * 1024;
const RATE_LIMIT_CLOSE_CODE = 1013;

interface Client {
  readonly socket: WebSocket;
  readonly source: string;
  readonly abuse: ClientAbuseState;
  room: RoomSession["room"] | null;
  player: RoomPlayer | null;
}

const manager = new RoomManager();
const abuseControls = new OnlineAbuseControls();
const clients = new Set<Client>();
const pendingUpgrades = new Map<Socket, string>();

function allowedOrigins(): readonly string[] {
  return (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function originAllowed(origin: string | undefined): boolean {
  const allowed = allowedOrigins();
  return (
    allowed.length === 0 || (origin !== undefined && allowed.includes(origin))
  );
}

function send(client: Client, value: unknown): void {
  if (client.socket.readyState !== WebSocket.OPEN) return;
  client.socket.send(JSON.stringify(value));
}

type RateLimitedScope = Exclude<OnlineRateLimitScope, "connection">;

function sendError(
  client: Client,
  message: string,
  details: {
    readonly code?: OnlineErrorCode;
    readonly scope?: RateLimitedScope;
    readonly retryAfterMs?: number;
  } = {},
  includeSnapshot = true,
): void {
  send(client, { type: "error", message, ...details });
  if (includeSnapshot && client.room && client.player) sendSnapshot(client);
}

function rateLimitMessage(scope: RateLimitedScope): string {
  switch (scope) {
    case "create":
      return "ルーム作成の試行回数が上限に達しました。しばらく待ってから再試行してください。";
    case "join":
      return "ルーム参加の試行回数が上限に達しました。しばらく待ってから再試行してください。";
    case "resume":
      return "再接続の試行回数が上限に達しました。しばらく待ってから再試行してください。";
    case "action":
      return "対局操作が多すぎます。しばらく待ってから再試行してください。";
    case "message":
      return "メッセージが多すぎます。しばらく待ってから再試行してください。";
  }
}

function rejectRateLimited(client: Client, rejection: AbuseRejection): void {
  if (rejection.code !== "rate_limited") return;
  if (rejection.scope === "connection") return;
  sendError(
    client,
    rateLimitMessage(rejection.scope),
    {
      code: rejection.code,
      scope: rejection.scope,
      retryAfterMs: rejection.retryAfterMs,
    },
    false,
  );
  client.socket.close(RATE_LIMIT_CLOSE_CODE, "rate limited");
}

function consumeRoomAttempt(client: Client, scope: RoomAttemptScope): boolean {
  const rejection = abuseControls.consumeRoomAttempt(client.source, scope);
  if (rejection === null) return false;
  rejectRateLimited(client, rejection);
  return true;
}

function consumeAction(client: Client): boolean {
  const rejection = abuseControls.consumeAction(client.source, client.abuse);
  if (rejection === null) return false;
  rejectRateLimited(client, rejection);
  return true;
}

function sendSnapshot(client: Client): void {
  if (!client.room || !client.player) return;
  send(client, {
    type: "snapshot",
    snapshot: manager.snapshot(client.room, client.player),
  });
}

function broadcast(room: RoomSession["room"]): void {
  for (const client of clients) {
    if (client.room === room && client.player) sendSnapshot(client);
  }
}

function connectionState(client: Client): ConnectionState {
  return {
    key: client,
    room: client.room,
    playerId: client.player?.id ?? null,
    readyState: client.socket.readyState,
  };
}

function hasOpenPeer(client: Client): boolean {
  return hasOpenPeerConnection(
    connectionState(client),
    [...clients].map(connectionState),
  );
}

function attach(client: Client, session: RoomSession): void {
  registerReplacementBeforeClose(
    client,
    session,
    () => manager.touch(session.room, session.player),
    () => {
      for (const other of clients) {
        if (
          other !== client &&
          other.room === session.room &&
          other.player?.id === session.player.id
        ) {
          other.socket.close(4001, "reconnected");
        }
      }
    },
  );
  send(client, {
    type: "session",
    token: session.player.token,
    snapshot: manager.snapshot(session.room, session.player),
  });
  broadcast(session.room);
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function handleMessage(client: Client, value: unknown): void {
  const message = record(value);
  if (!message || typeof message.type !== "string") {
    sendError(client, "不正なメッセージです。");
    return;
  }

  switch (message.type) {
    case "create": {
      if (consumeRoomAttempt(client, "create")) return;
      if (client.room) {
        sendError(client, "すでにルームへ接続しています。");
        return;
      }
      try {
        attach(
          client,
          manager.create(normalizePlayerName(message.name, "ホスト")),
        );
      } catch (error) {
        sendError(
          client,
          error instanceof Error
            ? error.message
            : "ルームを作成できませんでした。",
        );
      }
      return;
    }
    case "join": {
      if (consumeRoomAttempt(client, "join")) return;
      if (client.room) {
        sendError(client, "すでにルームへ接続しています。");
        return;
      }
      const code = normalizeRoomCode(message.code);
      const session = manager.join(code, message.name);
      if (!session) {
        sendError(client, "ルームが見つからないか、満席です。");
        return;
      }
      attach(client, session);
      return;
    }
    case "resume": {
      if (consumeRoomAttempt(client, "resume")) return;
      if (client.room) {
        sendError(client, "すでにルームへ接続しています。");
        return;
      }
      const session = manager.resume(message.code, message.token);
      if (!session) {
        sendError(
          client,
          "再接続情報が無効か、ルームの有効期限が切れています。",
        );
        return;
      }
      attach(client, session);
      return;
    }
    case "newGame": {
      if (consumeAction(client)) return;
      if (!client.room || !client.player) {
        sendError(client, "先にルームへ入室してください。");
        return;
      }
      const result = manager.newGame(client.room, client.player);
      if (!result.ok) {
        sendError(client, result.error);
        return;
      }
      broadcast(client.room);
      return;
    }
    case "action": {
      if (consumeAction(client)) return;
      if (!client.room || !client.player) {
        sendError(client, "先にルームへ入室してください。");
        return;
      }
      const expectedVersion = message.version;
      if (
        typeof expectedVersion !== "number" ||
        !Number.isSafeInteger(expectedVersion) ||
        expectedVersion < 0
      ) {
        sendError(client, "対局バージョンが不正です。");
        return;
      }
      const action = parseGameAction(message.action);
      if (!action) {
        sendError(client, "不正な対局操作です。");
        return;
      }
      const result = manager.apply(
        client.room,
        client.player,
        action,
        expectedVersion,
      );
      if (!result.ok) {
        sendError(client, result.error);
        return;
      }
      broadcast(client.room);
      return;
    }
    case "ping":
      send(client, { type: "pong" });
      return;
    default:
      sendError(client, "未対応のメッセージです。");
  }
}

function onConnection(socket: WebSocket, source: string): void {
  const client: Client = {
    socket,
    source,
    abuse: abuseControls.createClientState(),
    room: null,
    player: null,
  };
  clients.add(client);
  socket.on("message", (data) => {
    if (Buffer.byteLength(data.toString()) > MAX_MESSAGE_BYTES) {
      sendError(
        client,
        "メッセージが大きすぎます。",
        { code: "message_too_large" },
        false,
      );
      socket.close(1009, "message too large");
      return;
    }
    const messageRejection = abuseControls.consumeMessage(
      client.source,
      client.abuse,
    );
    if (messageRejection !== null) {
      rejectRateLimited(client, messageRejection);
      return;
    }
    try {
      handleMessage(client, JSON.parse(data.toString()));
    } catch {
      sendError(client, "メッセージを読み取れませんでした。");
    }
  });
  socket.on("close", () => {
    clients.delete(client);
    abuseControls.releaseConnection(client.source);
    // 再接続時は旧ソケットのcloseが新ソケットの接続状態を上書きし得る。
    // 同じ席に生きたソケットが残っている間は、切断扱いにしない。
    if (client.room && client.player && !hasOpenPeer(client)) {
      manager.disconnect(client.room, client.player);
      broadcast(client.room);
    }
  });
  socket.on("error", () => {
    // closeイベントで接続状態を更新する。クライアントへ内部エラーは返さない。
  });
}

function writeJson(
  response: import("node:http").ServerResponse,
  status: number,
  value: unknown,
): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  response.end(body);
}

const httpServer = createServer((request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    response.end();
    return;
  }
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (path === "/healthz") {
    writeJson(response, 200, { ok: true, service: "four-bros-mahjong-online" });
    return;
  }
  if (path === "/") {
    writeJson(response, 200, {
      service: "four-bros-mahjong-online",
      websocket: "/ws",
      health: "/healthz",
    });
    return;
  }
  writeJson(response, 404, { ok: false, error: "not_found" });
});

const websocketServer = new WebSocketServer({
  noServer: true,
  maxPayload: MAX_MESSAGE_BYTES,
});

function connectionSource(request: IncomingMessage): string {
  const address = request.socket.remoteAddress;
  if (!address) return "unknown";
  return address.startsWith("::ffff:")
    ? address.slice("::ffff:".length)
    : address;
}

function activeSourceConnections(source: string): number {
  let count = 0;
  for (const client of clients) if (client.source === source) count += 1;
  for (const pendingSource of pendingUpgrades.values())
    if (pendingSource === source) count += 1;
  return count;
}

function rejectUpgrade(
  socket: Socket,
  status: 429 | 503,
  rejection: AbuseRejection,
): void {
  const body = JSON.stringify({
    ok: false,
    code: rejection.code,
    ...(rejection.code === "rate_limited" ? { scope: rejection.scope } : {}),
    retryAfterMs: rejection.retryAfterMs,
  });
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil(rejection.retryAfterMs / 1_000),
  );
  const reason = status === 429 ? "Too Many Requests" : "Service Unavailable";
  try {
    socket.end(
      `HTTP/1.1 ${status} ${reason}\r\n` +
        "Connection: close\r\n" +
        "Content-Type: application/json; charset=utf-8\r\n" +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        `Retry-After: ${retryAfterSeconds}\r\n` +
        "\r\n" +
        body,
    );
  } catch {
    socket.destroy();
  }
}

function reserveUpgrade(socket: Socket, source: string): AbuseRejection | null {
  const rejection = abuseControls.admitConnection(
    source,
    clients.size + pendingUpgrades.size,
    activeSourceConnections(source),
  );
  if (rejection !== null) return rejection;
  pendingUpgrades.set(socket, source);
  return null;
}

websocketServer.on("connection", (socket, request) => {
  onConnection(socket, connectionSource(request));
});

httpServer.on("upgrade", (request: IncomingMessage, socket: Socket, head) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (path !== "/ws" || !originAllowed(request.headers.origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const source = connectionSource(request);
  const rejection = reserveUpgrade(socket, source);
  if (rejection !== null) {
    rejectUpgrade(
      socket,
      rejection.code === "rate_limited" ? 429 : 503,
      rejection,
    );
    return;
  }
  const releaseReservation = () => {
    if (!pendingUpgrades.delete(socket)) return;
    socket.off("close", releaseReservation);
    socket.off("error", releaseReservation);
    abuseControls.releaseConnection(source);
  };
  socket.once("close", releaseReservation);
  socket.once("error", releaseReservation);
  try {
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      releaseReservation();
      websocketServer.emit("connection", websocket, request);
    });
  } catch {
    releaseReservation();
    socket.destroy();
  }
});

const sweepTimer = setInterval(
  () => {
    manager.sweep();
    abuseControls.cleanup();
  },
  5 * 60 * 1000,
);
sweepTimer.unref();

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`FourBrosMahjong online server listening on ${PORT}`);
});
