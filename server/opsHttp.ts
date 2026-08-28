import type { IncomingMessage, ServerResponse } from "node:http";
import type { DrainControllerStatus, DrainTransition } from "./drainController";
import type { MaintenanceBroadcastResult } from "./maintenanceProtocol";
import {
  type MaintenanceTimelineStatus,
  maintenanceIsoTimestamp,
} from "./maintenanceTimeline";
import type { OpsBearerAuthenticator } from "./opsAuth";
import type { OpsAuthRateLimiter } from "./opsRateLimit";

export const ONLINE_OPS_STATUS_PATH = "/ops/status";
export const ONLINE_OPS_DRAIN_PATH = "/ops/drain";

type OpsPath = typeof ONLINE_OPS_STATUS_PATH | typeof ONLINE_OPS_DRAIN_PATH;

export interface OpsHttpDependencies {
  readonly routesAvailable: boolean;
  readonly maintenanceNoticesEnabled: boolean;
  readonly authenticator: OpsBearerAuthenticator | null;
  readonly rateLimiter: OpsAuthRateLimiter;
  /** Timeline wrappers preflight wall time before at-most-once mutations. */
  readonly startDrain: () => DrainTransition;
  readonly releaseDrain: () => DrainTransition;
  readonly maintenanceTimeline: () => MaintenanceTimelineStatus;
  readonly reconnectGraceMs: number;
  readonly sourceRevision: string | null;
  readonly deploymentId: string | null;
  readonly replicaId: string | null;
  readonly uptimeMs: () => number;
  /** Server-owned wall clock sampled and canonicalized at the HTTP boundary. */
  readonly observedAtMs: () => number;
  readonly sourceFor: (request: IncomingMessage) => string;
  /** Reads state through the server's transition-observing boundary. */
  readonly observeStatus: () => DrainControllerStatus;
  readonly broadcastDrainStatus: (
    status: DrainControllerStatus,
  ) => MaintenanceBroadcastResult;
  readonly broadcastAccepting: () => MaintenanceBroadcastResult;
}

function isOpsPath(path: string): path is OpsPath {
  return path === ONLINE_OPS_STATUS_PATH || path === ONLINE_OPS_DRAIN_PATH;
}

function isOpsNamespace(path: string): boolean {
  return path === "/ops" || path.startsWith("/ops/");
}

function writeOpsJson(
  response: ServerResponse,
  status: number,
  value: unknown,
  headers: Readonly<Record<string, string>> = {},
): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    connection: "close",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  response.end(body);
}

function methodAllowed(path: OpsPath, method: string | undefined): boolean {
  return path === ONLINE_OPS_STATUS_PATH
    ? method === "GET"
    : method === "POST" || method === "DELETE";
}

function allowedMethods(path: OpsPath): string {
  return path === ONLINE_OPS_STATUS_PATH ? "GET" : "POST, DELETE";
}

function rejectUnexpectedBody(
  request: IncomingMessage,
  response: ServerResponse,
): boolean {
  if (request.headers["content-type"] !== undefined) {
    request.resume();
    writeOpsJson(response, 415, {
      ok: false,
      error: "unsupported_media_type",
    });
    return true;
  }
  const contentLength = request.headers["content-length"];
  const transferEncoding = request.headers["transfer-encoding"];
  if (
    transferEncoding !== undefined ||
    (contentLength !== undefined && contentLength !== "0")
  ) {
    request.resume();
    writeOpsJson(response, 400, { ok: false, error: "body_not_allowed" });
    return true;
  }
  return false;
}

function statusPayload(
  dependencies: OpsHttpDependencies,
  status: DrainControllerStatus,
  sampledUptimeMs = dependencies.uptimeMs(),
  sampledObservedAt = maintenanceIsoTimestamp(dependencies.observedAtMs()),
): Record<string, unknown> {
  if (!Number.isSafeInteger(sampledUptimeMs) || sampledUptimeMs < 0) {
    throw new RangeError("ops uptime must be a non-negative safe integer");
  }
  return {
    ok: true,
    phase: status.phase,
    // Process-local monotonic values are deliberately not exposed as wall
    // timestamps. The server-owned display timeline supplies ISO values.
    ...dependencies.maintenanceTimeline(),
    reconnectGraceMs: dependencies.reconnectGraceMs,
    sourceRevision: dependencies.sourceRevision,
    deploymentId: dependencies.deploymentId,
    replicaId: dependencies.replicaId,
    observedAt: sampledObservedAt,
    uptimeMs: sampledUptimeMs,
    aggregate: status.aggregate,
  };
}

/**
 * Handle the private exact ops routes. `false` means the public router owns
 * the path. Every handled response deliberately omits all CORS headers.
 */
export function handleOpsHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
  dependencies: OpsHttpDependencies,
): boolean {
  if (!isOpsNamespace(path)) return false;

  if (!isOpsPath(path)) {
    request.resume();
    writeOpsJson(response, 404, { ok: false, error: "not_found" });
    return true;
  }

  try {
    if (!dependencies.routesAvailable || dependencies.authenticator === null) {
      request.resume();
      writeOpsJson(response, 404, { ok: false, error: "not_found" });
      return true;
    }

    const rateRejection = dependencies.rateLimiter.consume(
      dependencies.sourceFor(request),
    );
    if (rateRejection !== null) {
      request.resume();
      writeOpsJson(
        response,
        429,
        {
          ok: false,
          error: "rate_limited",
          scope: rateRejection.scope,
          retryAfterMs: rateRejection.retryAfterMs,
        },
        {
          "retry-after": String(
            Math.max(1, Math.ceil(rateRejection.retryAfterMs / 1_000)),
          ),
        },
      );
      return true;
    }

    const authorizationValues = request.headersDistinct?.authorization;
    const authorization =
      authorizationValues === undefined
        ? request.headers.authorization
        : authorizationValues.length === 1
          ? authorizationValues[0]
          : authorizationValues;
    if (!dependencies.authenticator.verify(authorization)) {
      request.resume();
      writeOpsJson(response, 401, { ok: false, error: "unauthorized" });
      return true;
    }

    if (!methodAllowed(path, request.method)) {
      request.resume();
      writeOpsJson(
        response,
        405,
        { ok: false, error: "method_not_allowed" },
        { allow: allowedMethods(path) },
      );
      return true;
    }
    if (rejectUnexpectedBody(request, response)) return true;

    if (path === ONLINE_OPS_STATUS_PATH) {
      const status = dependencies.observeStatus();
      writeOpsJson(response, 200, statusPayload(dependencies, status));
      return true;
    }

    if (!dependencies.maintenanceNoticesEnabled) {
      writeOpsJson(response, 409, {
        ok: false,
        error: "maintenance_notices_disabled",
      });
      return true;
    }

    if (request.method === "POST") {
      // Validate all payload providers before the at-most-once transition.
      const sampledUptimeMs = dependencies.uptimeMs();
      const sampledObservedAt = maintenanceIsoTimestamp(
        dependencies.observedAtMs(),
      );
      if (!Number.isSafeInteger(sampledUptimeMs) || sampledUptimeMs < 0) {
        throw new RangeError("ops uptime must be a non-negative safe integer");
      }
      const transition = dependencies.startDrain();
      const broadcast = transition.changed
        ? dependencies.broadcastDrainStatus(transition.status)
        : null;
      writeOpsJson(response, 200, {
        ...statusPayload(
          dependencies,
          transition.status,
          sampledUptimeMs,
          sampledObservedAt,
        ),
        changed: transition.changed,
        broadcast,
      });
      return true;
    }

    // releaseDrain performs the phase check and transition atomically. Reading
    // status first could publish drained at the grace boundary immediately
    // before an operator-requested accepting notice.
    const sampledUptimeMs = dependencies.uptimeMs();
    const sampledObservedAt = maintenanceIsoTimestamp(
      dependencies.observedAtMs(),
    );
    if (!Number.isSafeInteger(sampledUptimeMs) || sampledUptimeMs < 0) {
      throw new RangeError("ops uptime must be a non-negative safe integer");
    }
    const transition = dependencies.releaseDrain();
    if (!transition.changed && transition.status.phase === "accepting") {
      writeOpsJson(response, 409, { ok: false, error: "not_draining" });
      return true;
    }
    if (!transition.changed && transition.status.phase === "terminating") {
      writeOpsJson(response, 409, { ok: false, error: "terminating" });
      return true;
    }
    if (!transition.changed || transition.status.phase !== "accepting") {
      writeOpsJson(response, 409, { ok: false, error: "release_rejected" });
      return true;
    }
    const broadcast = dependencies.broadcastAccepting();
    writeOpsJson(response, 200, {
      ...statusPayload(
        dependencies,
        transition.status,
        sampledUptimeMs,
        sampledObservedAt,
      ),
      changed: true,
      broadcast,
    });
    return true;
  } catch {
    request.resume();
    if (!response.headersSent) {
      writeOpsJson(response, 500, { ok: false, error: "internal_error" });
    } else {
      response.destroy();
    }
    return true;
  }
}
