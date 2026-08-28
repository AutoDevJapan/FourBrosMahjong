import { createServer, type IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import type {
  OnlineErrorCode,
  OnlineRateLimitScope,
} from "../src/components/online/types";
import { ROOM_CODE_FORMAT_MESSAGE } from "../src/lib/roomCode";
import {
  type AbuseRejection,
  type ClientAbuseState,
  OnlineAbuseControls,
  type RoomAttemptScope,
} from "./abuseControl";
import { connectionAggregateCounts } from "./connectionAggregate";
import { connectionSource } from "./connectionSource";
import {
  type ConnectionState,
  hasOpenPeer as hasOpenPeerConnection,
  registerReplacementBeforeClose,
} from "./connectionState";
import {
  DrainController,
  type DrainControllerStatus,
  type DrainTransition,
} from "./drainController";
import { startHandshakeTimeout } from "./handshake";
import { runHeartbeat, SERVER_HEARTBEAT_INTERVAL_MS } from "./heartbeat";
import {
  broadcastMaintenanceNotice,
  createMaintenanceAcceptingNotice,
  createMaintenanceNotice,
  type MaintenanceBroadcastResult,
} from "./maintenanceProtocol";
import { readOnlineOpsConfiguration } from "./opsConfig";
import { handleOpsHttpRequest } from "./opsHttp";
import { OpsAuthRateLimiter } from "./opsRateLimit";
import { requestPath } from "./requestPath";
import {
  type ConnectionAggregateCounts,
  normalizePlayerName,
  normalizeRoomCode,
  parseGameAction,
  RoomManager,
  type RoomPlayer,
  type RoomSession,
} from "./roomManager";
import {
  isAuthoritativeConnection,
  supersedeConnection,
} from "./socketAuthority";
import {
  admitUpgradeDuringDrain,
  type UpgradeDrainAdmission,
} from "./upgradeDrainAdmission";

const PORT = Number(process.env.PORT ?? 8080);
const MAX_MESSAGE_BYTES = 32 * 1024;
const RATE_LIMIT_CLOSE_CODE = 1013;
export const ONLINE_HEARTBEAT_INTERVAL_MS = SERVER_HEARTBEAT_INTERVAL_MS;

interface Client {
  readonly socket: WebSocket;
  readonly source: string;
  readonly abuse: ClientAbuseState;
  isAlive: boolean;
  superseded: boolean;
  room: RoomSession["room"] | null;
  player: RoomPlayer | null;
}

const manager = new RoomManager();
const abuseControls = new OnlineAbuseControls();
const clients = new Set<Client>();
const pendingUpgrades = new Map<Socket, string>();
const opsConfiguration = readOnlineOpsConfiguration();
const opsRateLimiter = new OpsAuthRateLimiter();
const processStartedAt = performance.now();

function currentConnectionCounts(): ConnectionAggregateCounts {
  return connectionAggregateCounts(clients, pendingUpgrades.size);
}

const drainController = new DrainController({
  currentConnections: currentConnectionCounts,
  currentAggregate: (connections) =>
    manager.aggregateSnapshot(
      opsConfiguration.config.reconnectGraceMs,
      connections,
    ),
  beginDrainObservation: () =>
    manager.createDrainAggregateObserver(
      opsConfiguration.config.reconnectGraceMs,
    ),
});

function allowedOrigins(): readonly string[] {
  return (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function originAllowed(origin: string | undefined): boolean {
  const allowed = allowedOrigins();
  // An absent or empty allowlist must never widen the WebSocket boundary.
  // Local and deployed environments must opt in with an explicit Origin.
  return allowed.length > 0 && origin !== undefined && allowed.includes(origin);
}

function send(client: Client, value: unknown): void {
  if (!isAuthoritativeConnection(client)) return;
  if (client.socket.readyState !== WebSocket.OPEN) return;
  try {
    client.socket.send(JSON.stringify(value));
  } catch {
    // One peer's transport failure must not prevent authoritative snapshots,
    // drain reevaluation, or delivery to the remaining peers.
  }
}

let drainTickTimer: ReturnType<typeof setInterval> | null = null;

function syncDrainTickTimer(status: DrainControllerStatus): void {
  if (status.phase === "draining") {
    if (drainTickTimer !== null) return;
    drainTickTimer = setInterval(
      () => {
        const transition = drainController.tick();
        publishDrainTransition(transition);
      },
      Math.min(1_000, opsConfiguration.config.reconnectGraceMs),
    );
    drainTickTimer.unref();
    return;
  }
  if (drainTickTimer !== null) {
    clearInterval(drainTickTimer);
    drainTickTimer = null;
  }
}

function stopDrainTickTimer(): void {
  if (drainTickTimer === null) return;
  clearInterval(drainTickTimer);
  drainTickTimer = null;
}

function maintenanceSockets(): readonly WebSocket[] {
  return [...clients]
    .filter(isAuthoritativeConnection)
    .map((client) => client.socket);
}

function broadcastDrainStatus(
  status: DrainControllerStatus,
): MaintenanceBroadcastResult {
  syncDrainTickTimer(status);
  if (
    !opsConfiguration.config.maintenanceNoticesEnabled ||
    status.phase === "accepting"
  ) {
    return Object.freeze({ sent: 0, skipped: 0, failed: 0 });
  }
  return broadcastMaintenanceNotice(
    maintenanceSockets(),
    createMaintenanceNotice(status.phase, {
      retryAfterMs: opsConfiguration.config.reconnectGraceMs,
    }),
  );
}

function broadcastAccepting(): MaintenanceBroadcastResult {
  // releaseDrain has already atomically committed accepting. Do not call a
  // second fallible aggregate provider between that transition and delivery.
  stopDrainTickTimer();
  if (!opsConfiguration.config.maintenanceNoticesEnabled) {
    return Object.freeze({ sent: 0, skipped: 0, failed: 0 });
  }
  return broadcastMaintenanceNotice(
    maintenanceSockets(),
    createMaintenanceAcceptingNotice(),
  );
}

function publishDrainTransition(transition: DrainTransition): void {
  syncDrainTickTimer(transition.status);
  if (!transition.changed || transition.status.phase === "accepting") return;
  broadcastDrainStatus(transition.status);
}

function observeDrainStatus(): DrainControllerStatus {
  const transition = drainController.tick();
  publishDrainTransition(transition);
  return transition.status;
}

function afterRoomMutation(): DrainControllerStatus {
  const transition = drainController.afterRoomMutation();
  publishDrainTransition(transition);
  return transition.status;
}

function observeNewConnection(client: Client): void {
  const transition = drainController.afterRoomMutation();
  if (transition.changed) {
    publishDrainTransition(transition);
    return;
  }
  syncDrainTickTimer(transition.status);
  if (!opsConfiguration.config.maintenanceNoticesEnabled) return;
  if (transition.status.phase === "accepting") return;
  broadcastMaintenanceNotice(
    [client.socket],
    createMaintenanceNotice(transition.status.phase, {
      retryAfterMs: opsConfiguration.config.reconnectGraceMs,
    }),
  );
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
    () => {
      manager.touch(session.room, session.player);
      afterRoomMutation();
    },
    () => {
      for (const other of clients) {
        if (
          other !== client &&
          other.room === session.room &&
          other.player?.id === session.player.id
        ) {
          // The replacement is authoritative before the old close callback.
          // Marking the old peer prevents actions or maintenance recovery from
          // racing through the brief OPEN -> CLOSING handoff window.
          supersedeConnection(other, () => {
            other.socket.close(4001, "reconnected");
          });
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

function rejectNewOperationForMaintenance(client: Client): boolean {
  const status = observeDrainStatus();
  if (status.phase === "accepting") return false;
  sendError(
    client,
    "メンテナンス中のため、この操作は利用できません。",
    {
      code: "maintenance",
      retryAfterMs: opsConfiguration.config.reconnectGraceMs,
    },
    false,
  );
  return true;
}

function handleMessage(client: Client, value: unknown): void {
  if (!isAuthoritativeConnection(client)) return;
  const message = record(value);
  if (!message || typeof message.type !== "string") {
    sendError(client, "不正なメッセージです。");
    return;
  }

  switch (message.type) {
    case "create": {
      if (rejectNewOperationForMaintenance(client)) return;
      if (consumeRoomAttempt(client, "create")) return;
      if (client.room) {
        sendError(client, "すでにルームへ接続しています。");
        return;
      }
      try {
        const session = manager.create(
          normalizePlayerName(message.name, "ホスト"),
          message.explicitKita === true,
        );
        afterRoomMutation();
        attach(client, session);
      } catch {
        sendError(client, "ルームを作成できませんでした。");
      }
      return;
    }
    case "join": {
      if (rejectNewOperationForMaintenance(client)) return;
      if (consumeRoomAttempt(client, "join")) return;
      if (client.room) {
        sendError(client, "すでにルームへ接続しています。");
        return;
      }
      const code = normalizeRoomCode(message.code);
      if (code === null) {
        sendError(client, ROOM_CODE_FORMAT_MESSAGE);
        return;
      }
      const session = manager.join(
        code,
        message.name,
        message.explicitKita === true,
      );
      if (!session) {
        sendError(client, "ルームが見つからないか、満席です。");
        return;
      }
      afterRoomMutation();
      attach(client, session);
      return;
    }
    case "resume": {
      const observedStatus = observeDrainStatus();
      if (
        observedStatus.phase === "drained" ||
        observedStatus.phase === "terminating"
      ) {
        sendError(
          client,
          "メンテナンス中のため、この操作は利用できません。",
          {
            code: "maintenance",
            retryAfterMs: opsConfiguration.config.reconnectGraceMs,
          },
          false,
        );
        return;
      }
      if (consumeRoomAttempt(client, "resume")) return;
      if (client.room) {
        sendError(client, "すでにルームへ接続しています。");
        return;
      }
      const attempt = drainController.attemptResume({
        normal: () =>
          manager.resume(
            message.code,
            message.token,
            message.explicitKita === true,
          ),
        bounded: () =>
          manager.resumeDuringDrain(
            message.code,
            message.token,
            opsConfiguration.config.reconnectGraceMs,
            message.explicitKita === true,
          ),
      });
      publishDrainTransition(attempt.transition);
      if (
        attempt.outcome === "blocked" ||
        (attempt.session === null &&
          (attempt.transition.status.phase === "drained" ||
            attempt.transition.status.phase === "terminating"))
      ) {
        sendError(
          client,
          "メンテナンス中のため、この操作は利用できません。",
          {
            code: "maintenance",
            retryAfterMs: opsConfiguration.config.reconnectGraceMs,
          },
          false,
        );
        return;
      }
      if (attempt.outcome === "failed") {
        sendError(client, "再接続を処理できませんでした。", {}, false);
        return;
      }
      const session = attempt.session;
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
    case "leave": {
      if (!client.room || !client.player) {
        sendError(client, "先にルームへ入室してください。", {}, false);
        return;
      }
      const room = client.room;
      manager.leave(room, client.player);
      broadcast(room);
      afterRoomMutation();
      client.socket.close(1000, "left");
      return;
    }
    case "newGame": {
      if (rejectNewOperationForMaintenance(client)) return;
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
      afterRoomMutation();
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
      afterRoomMutation();
      return;
    }
    case "ping":
      if (client.room && client.player) {
        manager.touch(client.room, client.player);
        afterRoomMutation();
      }
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
    isAlive: true,
    superseded: false,
    room: null,
    player: null,
  };
  clients.add(client);
  const handshakeTimeout = startHandshakeTimeout(() => {
    // There is no room seat to preserve yet. Terminate instead of waiting for
    // a close handshake from an unauthenticated peer so the connection slot is
    // released even when the peer is deliberately uncooperative.
    socket.terminate();
  });
  socket.on("pong", () => {
    if (!isAuthoritativeConnection(client)) return;
    client.isAlive = true;
    if (client.room && client.player) {
      manager.touch(client.room, client.player);
      afterRoomMutation();
    }
  });
  socket.on("message", (data) => {
    // Replacement registration marks the old peer synchronously before its
    // close event. Ignore it before byte/rate accounting or any mutation.
    if (!isAuthoritativeConnection(client)) return;
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
      if (client.room && client.player) handshakeTimeout.complete();
    } catch {
      sendError(client, "メッセージを読み取れませんでした。");
    }
  });
  socket.on("close", () => {
    handshakeTimeout.clear();
    clients.delete(client);
    abuseControls.releaseConnection(client.source);
    // 再接続時は旧ソケットのcloseが新ソケットの接続状態を上書きし得る。
    // 同じ席に生きたソケットが残っている間は、切断扱いにしない。
    if (client.room && client.player && !hasOpenPeer(client)) {
      const status = observeDrainStatus();
      if (status.phase === "draining") {
        manager.disconnectDuringDrain(client.room, client.player);
      } else {
        manager.disconnect(client.room, client.player);
      }
      broadcast(client.room);
      afterRoomMutation();
    } else {
      afterRoomMutation();
    }
  });
  socket.on("error", () => {
    // closeイベントで接続状態を更新する。クライアントへ内部エラーは返さない。
  });
  // One reevaluation both accounts for this transport and sends its current
  // notice. If this exact hook seals drained, the transition broadcast already
  // includes the new socket, so a second direct notice would be a duplicate.
  observeNewConnection(client);
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

const opsHttpDependencies = {
  routesAvailable: opsConfiguration.opsRoutesAvailable,
  maintenanceNoticesEnabled: opsConfiguration.config.maintenanceNoticesEnabled,
  authenticator: opsConfiguration.config.authenticator,
  rateLimiter: opsRateLimiter,
  drainController,
  reconnectGraceMs: opsConfiguration.config.reconnectGraceMs,
  sourceRevision: opsConfiguration.config.sourceRevision,
  uptimeMs: () => Math.max(0, Math.floor(performance.now() - processStartedAt)),
  sourceFor: (request: IncomingMessage) => connectionSource(request),
  observeStatus: observeDrainStatus,
  broadcastDrainStatus,
  broadcastAccepting,
} as const;

const httpServer = createServer((request, response) => {
  const path = requestPath(request.url);
  if (path === null) {
    writeJson(response, 400, { ok: false, error: "bad_request" });
    return;
  }
  if (handleOpsHttpRequest(request, response, path, opsHttpDependencies)) {
    return;
  }
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    response.end();
    return;
  }
  if (path === "/healthz") {
    writeJson(response, 200, { ok: true, service: "four-bros-mahjong-online" });
    return;
  }
  if (path === "/readyz") {
    const ready =
      observeDrainStatus().phase === "accepting" &&
      !opsConfiguration.readinessBlocked;
    writeJson(response, ready ? 200 : 503, { ok: ready });
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

function rejectMaintenanceUpgrade(socket: Socket): void {
  const body = JSON.stringify({
    ok: false,
    code: "maintenance",
    retryAfterMs: opsConfiguration.config.reconnectGraceMs,
  });
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil(opsConfiguration.config.reconnectGraceMs / 1_000),
  );
  try {
    socket.end(
      "HTTP/1.1 503 Service Unavailable\r\n" +
        "Connection: close\r\n" +
        "Content-Type: application/json; charset=utf-8\r\n" +
        "Cache-Control: no-store\r\n" +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        `Retry-After: ${retryAfterSeconds}\r\n` +
        "\r\n" +
        body,
    );
  } catch {
    socket.destroy();
  }
}

function rejectUnavailableUpgrade(socket: Socket): void {
  const body = JSON.stringify({ ok: false, code: "temporarily_unavailable" });
  try {
    socket.end(
      "HTTP/1.1 503 Service Unavailable\r\n" +
        "Connection: close\r\n" +
        "Content-Type: application/json; charset=utf-8\r\n" +
        "Cache-Control: no-store\r\n" +
        `Content-Length: ${Buffer.byteLength(body)}\r\n` +
        "\r\n" +
        body,
    );
  } catch {
    socket.destroy();
  }
}

function reserveUpgrade(
  socket: Socket,
  source: string,
):
  | { readonly ok: false; readonly rejection: AbuseRejection }
  | { readonly ok: true; readonly phase: DrainControllerStatus["phase"] } {
  const rejection = abuseControls.admitConnection(
    source,
    clients.size + pendingUpgrades.size,
    activeSourceConnections(source),
  );
  if (rejection !== null) return { ok: false, rejection };
  pendingUpgrades.set(socket, source);
  try {
    return { ok: true, phase: afterRoomMutation().phase };
  } catch (error) {
    pendingUpgrades.delete(socket);
    abuseControls.releaseConnection(source);
    throw error;
  }
}

function releasePendingUpgrade(socket: Socket, source: string): boolean {
  if (!pendingUpgrades.delete(socket)) return false;
  abuseControls.releaseConnection(source);
  afterRoomMutation();
  return true;
}

websocketServer.on("connection", (socket, request) => {
  onConnection(socket, connectionSource(request));
});

httpServer.on("upgrade", (request: IncomingMessage, socket: Socket, head) => {
  const path = requestPath(request.url);
  if (path === null) {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    return;
  }
  if (path !== "/ws" || !originAllowed(request.headers.origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const source = connectionSource(request);
  let admission: UpgradeDrainAdmission<AbuseRejection>;
  try {
    admission = admitUpgradeDuringDrain({
      observePhase: () => observeDrainStatus().phase,
      reserve: () => reserveUpgrade(socket, source),
      rollback: () => {
        releasePendingUpgrade(socket, source);
      },
    });
  } catch {
    rejectUnavailableUpgrade(socket);
    return;
  }
  if (admission.outcome === "rejected") {
    rejectUpgrade(
      socket,
      admission.rejection.code === "rate_limited" ? 429 : 503,
      admission.rejection,
    );
    return;
  }
  if (admission.outcome === "maintenance") {
    rejectMaintenanceUpgrade(socket);
    return;
  }
  const releaseReservation = () => {
    if (!releasePendingUpgrade(socket, source)) return;
    socket.off("close", releaseReservation);
    socket.off("error", releaseReservation);
  };
  const transferReservation = () => {
    if (!pendingUpgrades.delete(socket)) return false;
    socket.off("close", releaseReservation);
    socket.off("error", releaseReservation);
    abuseControls.releaseConnection(source);
    // onConnection synchronously swaps this reservation for the established
    // client and performs one reevaluation; do not expose a zero-count gap.
    return true;
  };
  socket.once("close", releaseReservation);
  socket.once("error", releaseReservation);
  try {
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      if (!transferReservation()) {
        websocket.terminate();
        return;
      }
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
    afterRoomMutation();
    opsRateLimiter.cleanup();
    abuseControls.cleanup();
  },
  5 * 60 * 1000,
);
sweepTimer.unref();

const heartbeatTimer = setInterval(
  () => runHeartbeat(clients),
  ONLINE_HEARTBEAT_INTERVAL_MS,
);
heartbeatTimer.unref();

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`FourBrosMahjong online server listening on ${PORT}`);
});
