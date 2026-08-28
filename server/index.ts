import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
} from "node:http";
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
import { type HandshakeTimeout, startHandshakeTimeout } from "./handshake";
import { runHeartbeat, SERVER_HEARTBEAT_INTERVAL_MS } from "./heartbeat";
import {
  broadcastMaintenanceNotice,
  closeSocketForMaintenance,
  createMaintenanceAcceptingNotice,
  createMaintenanceNotice,
  type MaintenanceBroadcastResult,
} from "./maintenanceProtocol";
import { MaintenanceTimeline } from "./maintenanceTimeline";
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
  GracefulShutdownController,
  type ShutdownEvent,
  type ShutdownScheduler,
  type ShutdownSignal,
} from "./shutdownController";
import {
  isAuthoritativeConnection,
  supersedeConnection,
} from "./socketAuthority";
import {
  admitUpgradeDuringDrain,
  type UpgradeDrainAdmission,
} from "./upgradeDrainAdmission";

const MAX_MESSAGE_BYTES = 32 * 1024;
const RATE_LIMIT_CLOSE_CODE = 1013;
const ONLINE_HEARTBEAT_INTERVAL_MS = SERVER_HEARTBEAT_INTERVAL_MS;

interface Client {
  readonly socket: WebSocket;
  readonly source: string;
  readonly abuse: ClientAbuseState;
  isAlive: boolean;
  superseded: boolean;
  room: RoomSession["room"] | null;
  player: RoomPlayer | null;
}

export interface OnlineServerOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly monotonicNow?: () => number;
  readonly wallNow?: () => number;
  readonly shutdownScheduler?: ShutdownScheduler;
  readonly shutdownPollIntervalMs?: number;
  readonly onShutdownEvent?: (event: ShutdownEvent) => void;
}

export interface OnlineServer {
  readonly httpServer: HttpServer;
  readonly websocketServer: WebSocketServer;
  readonly shutdownController: GracefulShutdownController;
  listen(port?: number, host?: string): Promise<void>;
  handleSignal(signal: ShutdownSignal): Promise<void>;
}

/** Build one isolated server instance without listening or installing signals. */
export function createOnlineServer(
  options: OnlineServerOptions = {},
): OnlineServer {
  const environment = options.environment ?? process.env;
  const monotonicNow = options.monotonicNow ?? (() => performance.now());
  const manager = new RoomManager({ monotonicNow });
  const abuseControls = new OnlineAbuseControls();
  const clients = new Set<Client>();
  const pendingUpgrades = new Map<Socket, string>();
  const shutdownPendingSockets = new Set<Socket>();
  const opsConfiguration = readOnlineOpsConfiguration(environment);
  const opsRateLimiter = new OpsAuthRateLimiter();
  const processStartedAt = monotonicNow();
  const wallNow = options.wallNow ?? Date.now;
  const maintenanceTimeline = new MaintenanceTimeline({
    wallNow,
    shutdownGraceMs: opsConfiguration.config.shutdownGraceMs,
  });
  let shutdownController: GracefulShutdownController | null = null;
  const handshakeTimeouts = new Set<HandshakeTimeout>();

  function currentConnectionCounts(): ConnectionAggregateCounts {
    return connectionAggregateCounts(clients, pendingUpgrades.size);
  }

  const drainController = new DrainController({
    monotonicNow,
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
    return (environment.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
  }

  function originAllowed(origin: string | undefined): boolean {
    const allowed = allowedOrigins();
    // An absent or empty allowlist must never widen the WebSocket boundary.
    // Local and deployed environments must opt in with an explicit Origin.
    return (
      allowed.length > 0 && origin !== undefined && allowed.includes(origin)
    );
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
    shutdownController?.reevaluate();
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

  function consumeRoomAttempt(
    client: Client,
    scope: RoomAttemptScope,
  ): boolean {
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
    const handshakeTimeout: HandshakeTimeout = startHandshakeTimeout(() => {
      handshakeTimeouts.delete(handshakeTimeout);
      // There is no room seat to preserve yet. Terminate instead of waiting for
      // a close handshake from an unauthenticated peer so the connection slot is
      // released even when the peer is deliberately uncooperative.
      socket.terminate();
    });
    const finishHandshake = () => {
      handshakeTimeout.clear();
      handshakeTimeouts.delete(handshakeTimeout);
    };
    handshakeTimeouts.add(handshakeTimeout);
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
        if (client.room && client.player) finishHandshake();
      } catch {
        sendError(client, "メッセージを読み取れませんでした。");
      }
    });
    socket.on("close", () => {
      finishHandshake();
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
      shutdownController?.socketClosed();
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
    maintenanceNoticesEnabled:
      opsConfiguration.config.maintenanceNoticesEnabled,
    authenticator: opsConfiguration.config.authenticator,
    rateLimiter: opsRateLimiter,
    startDrain: () =>
      maintenanceTimeline.startDrain(() => drainController.startDrain()),
    releaseDrain: () =>
      maintenanceTimeline.releaseDrain(() => drainController.releaseDrain()),
    maintenanceTimeline: () => maintenanceTimeline.status(),
    reconnectGraceMs: opsConfiguration.config.reconnectGraceMs,
    sourceRevision: opsConfiguration.config.sourceRevision,
    deploymentId: opsConfiguration.config.deploymentId,
    replicaId: opsConfiguration.config.replicaId,
    uptimeMs: () => Math.max(0, Math.floor(monotonicNow() - processStartedAt)),
    observedAtMs: wallNow,
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
      writeJson(response, 200, {
        ok: true,
        service: "four-bros-mahjong-online",
      });
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

  let sweepTimer: ReturnType<typeof setInterval> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  function startRuntimeTimers(): void {
    if (
      runtimeTimersStopped ||
      sweepTimer !== null ||
      heartbeatTimer !== null
    ) {
      return;
    }
    sweepTimer = setInterval(
      () => {
        manager.sweep();
        afterRoomMutation();
        opsRateLimiter.cleanup();
        abuseControls.cleanup();
      },
      5 * 60 * 1000,
    );
    sweepTimer.unref();
    heartbeatTimer = setInterval(
      () => runHeartbeat(clients),
      ONLINE_HEARTBEAT_INTERVAL_MS,
    );
    heartbeatTimer.unref();
  }

  let runtimeTimersStopped = false;
  let serverClosePromise: Promise<void> | null = null;
  let listenState: "idle" | "starting" | "listening" | "closed" = "idle";
  let startupSettledPromise: Promise<void> | null = null;
  let resolveStartupSettled: (() => void) | null = null;

  function stopRuntimeTimers(): void {
    if (runtimeTimersStopped) return;
    runtimeTimersStopped = true;
    stopDrainTickTimer();
    if (sweepTimer !== null) clearInterval(sweepTimer);
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
    sweepTimer = null;
    heartbeatTimer = null;
    for (const timeout of handshakeTimeouts) timeout.clear();
    handshakeTimeouts.clear();
  }

  function rejectPendingUpgradesForShutdown(): void {
    let changed = false;
    for (const [socket, source] of [...pendingUpgrades]) {
      if (!pendingUpgrades.delete(socket)) continue;
      changed = true;
      abuseControls.releaseConnection(source);
      shutdownPendingSockets.add(socket);
      socket.once("close", () => {
        shutdownPendingSockets.delete(socket);
        shutdownController?.socketClosed();
      });
      rejectMaintenanceUpgrade(socket);
    }
    if (changed) afterRoomMutation();
  }

  function requestSocketClose(): void {
    for (const client of clients) {
      if (!isAuthoritativeConnection(client)) continue;
      closeSocketForMaintenance(client.socket);
    }
  }

  function terminateSockets(): void {
    for (const client of clients) {
      try {
        client.socket.terminate();
      } catch {
        // Continue terminating the remaining transports.
      }
    }
    for (const socket of shutdownPendingSockets) {
      try {
        socket.destroy();
      } catch {
        // Continue terminating the remaining transports.
      }
    }
  }

  function openSocketCount(): number {
    let count = 0;
    for (const client of clients) {
      if (client.socket.readyState !== WebSocket.CLOSED) count += 1;
    }
    count += shutdownPendingSockets.size;
    return count;
  }

  function closeWebSocketServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      websocketServer.close((error) => {
        if (
          error &&
          (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING" &&
          error.message !== "The server is not running"
        ) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  function closeHttpServer(): Promise<void> {
    if (!httpServer.listening) {
      if (listenState === "starting" && startupSettledPromise !== null) {
        return startupSettledPromise.then(() => closeHttpServer());
      }
      if (listenState !== "starting") listenState = "closed";
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      httpServer.close((error) => {
        listenState = "closed";
        if (
          error &&
          (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING"
        ) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  function closeServers(): Promise<void> {
    serverClosePromise ??= Promise.all([
      closeWebSocketServer(),
      closeHttpServer(),
    ]).then(() => undefined);
    return serverClosePromise;
  }

  function forceCloseServers(): Promise<void> {
    httpServer.closeAllConnections();
    return closeServers();
  }

  shutdownController = new GracefulShutdownController({
    shutdownGraceMs: opsConfiguration.config.shutdownGraceMs,
    socketCloseGraceMs: opsConfiguration.config.socketCloseGraceMs,
    pollIntervalMs: options.shutdownPollIntervalMs,
    monotonicNow,
    wallNow: options.wallNow,
    scheduler: options.shutdownScheduler,
    beginTermination: () => {
      const transition = drainController.beginTermination();
      // Do not use publishDrainTransition here: shutdown sends one deadline-aware
      // terminating notice below rather than a duplicate generic notice.
      syncDrainTickTimer(transition.status);
      return {
        blockingDrainRooms: transition.status.aggregate.blockingDrainRooms,
      };
    },
    blockingDrainRooms: () =>
      drainController.status().aggregate.blockingDrainRooms,
    announceTermination: (deadline) => {
      maintenanceTimeline.beginTermination(deadline);
      if (!opsConfiguration.config.maintenanceNoticesEnabled) return;
      broadcastMaintenanceNotice(
        maintenanceSockets(),
        createMaintenanceNotice("terminating", {
          ...(deadline === null ? {} : { deadline }),
        }),
      );
    },
    rejectPendingUpgrades: rejectPendingUpgradesForShutdown,
    stopRuntimeTimers,
    requestSocketClose,
    openSocketCount,
    terminateSockets,
    closeServers,
    forceCloseServers,
    onEvent: options.onShutdownEvent,
  });

  return Object.freeze({
    httpServer,
    websocketServer,
    shutdownController,
    listen(port = Number(environment.PORT ?? 8080), host = "0.0.0.0") {
      if (shutdownController.state().started || listenState !== "idle") {
        return Promise.reject(
          new Error("online server cannot start in this state"),
        );
      }
      listenState = "starting";
      startupSettledPromise = new Promise<void>((resolve) => {
        resolveStartupSettled = resolve;
      });
      return new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => {
          listenState = "closed";
          resolveStartupSettled?.();
          resolveStartupSettled = null;
          httpServer.off("error", onError);
          httpServer.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          httpServer.off("error", onError);
          if (shutdownController.state().started) {
            httpServer.closeAllConnections();
            httpServer.close(() => {
              listenState = "closed";
              resolveStartupSettled?.();
              resolveStartupSettled = null;
              reject(new Error("online server stopped during startup"));
            });
            return;
          }
          listenState = "listening";
          resolveStartupSettled?.();
          resolveStartupSettled = null;
          startRuntimeTimers();
          resolve();
        };
        httpServer.once("error", onError);
        httpServer.once("listening", onListening);
        try {
          httpServer.listen(port, host);
        } catch (error) {
          onError(error instanceof Error ? error : new Error("listen failed"));
        }
      });
    },
    handleSignal(signal: ShutdownSignal) {
      return shutdownController.handleSignal(signal);
    },
  });
}
