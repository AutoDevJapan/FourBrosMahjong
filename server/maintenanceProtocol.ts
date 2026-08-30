import type {
  OnlineMaintenanceAcceptingNotice,
  OnlineMaintenanceNotice,
  OnlineMaintenancePhase,
} from "../src/domain/online/types";

export const MAX_MAINTENANCE_RETRY_AFTER_MS = 10 * 60 * 1_000;
export const MAINTENANCE_CLOSE_CODE = 1012;
export const MAINTENANCE_CLOSE_REASON = "service restart";

const WEBSOCKET_OPEN = 1;
declare const maintenanceWireMessageBrand: unique symbol;

/**
 * Only the factories in this module construct branded wire messages. This
 * prevents callers from structurally adding room, player, token, operator, or
 * other arbitrary fields before broadcast.
 */
export type MaintenanceWireMessage = (
  | OnlineMaintenanceNotice
  | OnlineMaintenanceAcceptingNotice
) & {
  readonly [maintenanceWireMessageBrand]: true;
};

export interface MaintenanceNoticeTiming {
  readonly retryAfterMs?: number;
  /** A server-owned instant. Arbitrary operator-facing strings are not accepted. */
  readonly deadline?: Date;
}

export interface MaintenanceProtocolSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code: number, reason: string): void;
}

export interface MaintenanceBroadcastResult {
  readonly sent: number;
  readonly skipped: number;
  readonly failed: number;
}

function maintenanceRetryAfterMs(
  value: number | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  if (
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_MAINTENANCE_RETRY_AFTER_MS
  ) {
    throw new RangeError("maintenance retryAfterMs is outside its safe range");
  }
  return value;
}

function maintenancePhase(value: unknown): OnlineMaintenancePhase {
  if (value !== "draining" && value !== "drained" && value !== "terminating") {
    throw new TypeError("maintenance phase is not server-emittable");
  }
  return value;
}

function maintenanceDeadline(value: Date | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!(value instanceof Date)) {
    throw new TypeError("maintenance deadline must be a server-owned Date");
  }
  const time = Date.prototype.getTime.call(value);
  if (!Number.isFinite(time)) {
    throw new RangeError("maintenance deadline must be a valid instant");
  }
  const year = Date.prototype.getUTCFullYear.call(value);
  if (year < 0 || year > 9_999) {
    throw new RangeError(
      "maintenance deadline must use the client-compatible four-digit year",
    );
  }
  return new Date(time).toISOString();
}

/**
 * Build a client-compatible maintenance notice without accepting display text,
 * identifiers, credentials, or other untrusted fields.
 *
 * This module does not enable emission. Server wiring must remain behind the
 * separately reviewed default-off gate from issue #726.
 */
export function createMaintenanceNotice(
  phase: OnlineMaintenancePhase,
  timing: MaintenanceNoticeTiming = {},
): MaintenanceWireMessage {
  const safePhase = maintenancePhase(phase);
  const retryAfterMs = maintenanceRetryAfterMs(timing.retryAfterMs);
  const deadline = maintenanceDeadline(timing.deadline);
  return Object.freeze({
    type: "maintenance",
    phase: safePhase,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    ...(deadline === undefined ? {} : { deadline }),
  }) as MaintenanceWireMessage;
}

const ACCEPTING_NOTICE = Object.freeze({
  type: "maintenance",
  phase: "accepting",
}) as MaintenanceWireMessage;

/** Accepting is exact and can never carry stale retry/deadline metadata. */
export function createMaintenanceAcceptingNotice(): MaintenanceWireMessage {
  return ACCEPTING_NOTICE;
}

/**
 * Broadcast one prevalidated payload. A closed peer is skipped and one peer's
 * synchronous send failure never prevents delivery to the remaining peers.
 * The aggregate intentionally contains no peer identity or error text.
 */
export function broadcastMaintenanceNotice(
  sockets: Iterable<MaintenanceProtocolSocket>,
  message: MaintenanceWireMessage,
): MaintenanceBroadcastResult {
  const data = JSON.stringify(message);
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const socket of sockets) {
    if (socket.readyState !== WEBSOCKET_OPEN) {
      skipped += 1;
      continue;
    }
    try {
      socket.send(data);
      sent += 1;
    } catch {
      failed += 1;
    }
  }
  return Object.freeze({ sent, skipped, failed });
}

/** Close one OPEN client with the fixed RFC 6455 service-restart contract. */
export function closeSocketForMaintenance(
  socket: MaintenanceProtocolSocket,
): boolean {
  if (socket.readyState !== WEBSOCKET_OPEN) return false;
  try {
    socket.close(MAINTENANCE_CLOSE_CODE, MAINTENANCE_CLOSE_REASON);
    return true;
  } catch {
    return false;
  }
}
