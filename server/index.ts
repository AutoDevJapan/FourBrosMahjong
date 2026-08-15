import { createServer, type IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
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

interface Client {
  readonly socket: WebSocket;
  room: RoomSession["room"] | null;
  player: RoomPlayer | null;
}

const manager = new RoomManager();
const clients = new Set<Client>();

function allowedOrigins(): readonly string[] {
  return (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function originAllowed(origin: string | undefined): boolean {
  const allowed = allowedOrigins();
  return (
    allowed.length === 0 || origin === undefined || allowed.includes(origin)
  );
}

function send(client: Client, value: unknown): void {
  if (client.socket.readyState !== WebSocket.OPEN) return;
  client.socket.send(JSON.stringify(value));
}

function sendError(client: Client, message: string): void {
  send(client, { type: "error", message });
  if (client.room && client.player) sendSnapshot(client);
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

function attach(client: Client, session: RoomSession): void {
  for (const other of clients) {
    if (
      other !== client &&
      other.room === session.room &&
      other.player?.id === session.player.id
    ) {
      other.socket.close(4001, "reconnected");
    }
  }
  client.room = session.room;
  client.player = session.player;
  manager.touch(session.room, session.player);
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

function onConnection(socket: WebSocket): void {
  const client: Client = { socket, room: null, player: null };
  clients.add(client);
  socket.on("message", (data) => {
    if (Buffer.byteLength(data.toString()) > MAX_MESSAGE_BYTES) {
      sendError(client, "メッセージが大きすぎます。");
      socket.close(1009, "message too large");
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
    if (client.room && client.player) {
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
websocketServer.on("connection", onConnection);

httpServer.on("upgrade", (request: IncomingMessage, socket: Socket, head) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (path !== "/ws" || !originAllowed(request.headers.origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  websocketServer.handleUpgrade(request, socket, head, (websocket) => {
    websocketServer.emit("connection", websocket, request);
  });
});

const sweepTimer = setInterval(() => manager.sweep(), 5 * 60 * 1000);
sweepTimer.unref();

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`FourBrosMahjong online server listening on ${PORT}`);
});
