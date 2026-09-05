import { ONLINE_DRAIN_RECONNECT_GRACE_MS } from "./maintenanceLimits";
import { isValidOpsToken, OpsBearerAuthenticator } from "./opsAuth";

/** Compatibility aliases; bounds are owned by maintenanceLimits.ts. */
export const ONLINE_DRAIN_RECONNECT_GRACE_DEFAULT_MS =
  ONLINE_DRAIN_RECONNECT_GRACE_MS.default;
export const ONLINE_DRAIN_RECONNECT_GRACE_MIN_MS =
  ONLINE_DRAIN_RECONNECT_GRACE_MS.min;
export const ONLINE_DRAIN_RECONNECT_GRACE_MAX_MS =
  ONLINE_DRAIN_RECONNECT_GRACE_MS.max;
export const ONLINE_SHUTDOWN_GRACE_DEFAULT_MS = 25_000;
export const ONLINE_SHUTDOWN_GRACE_MIN_MS = 1_000;
export const ONLINE_SHUTDOWN_GRACE_MAX_MS = 300_000;
export const ONLINE_SOCKET_CLOSE_GRACE_DEFAULT_MS = 3_000;
export const ONLINE_SOCKET_CLOSE_GRACE_MIN_MS = 1_000;
export const ONLINE_SOCKET_CLOSE_GRACE_MAX_MS = 10_000;

type OnlineOpsConfigurationError =
  | "invalid-maintenance-notices-enabled"
  | "invalid-ops-required"
  | "invalid-reconnect-grace"
  | "invalid-shutdown-grace"
  | "invalid-socket-close-grace"
  | "invalid-source-revision"
  | "invalid-token"
  | "missing-source-revision"
  | "missing-token"
  | "socket-close-grace-not-less-than-shutdown";

interface OnlineOpsConfiguration {
  readonly required: boolean;
  readonly maintenanceNoticesEnabled: boolean;
  readonly authenticator: OpsBearerAuthenticator | null;
  readonly sourceRevision: string | null;
  readonly deploymentId: string | null;
  readonly replicaId: string | null;
  readonly reconnectGraceMs: number;
  readonly shutdownGraceMs: number;
  readonly socketCloseGraceMs: number;
}

export interface OnlineOpsConfigurationStatus {
  readonly config: OnlineOpsConfiguration;
  readonly errors: readonly OnlineOpsConfigurationError[];
  /** Exact ops routes must behave as unavailable (404) when this is false. */
  readonly opsRoutesAvailable: boolean;
  /** Required deployments use this directly as one input to `/readyz`. */
  readonly readinessBlocked: boolean;
  readonly valid: boolean;
}

type Environment = Readonly<Record<string, string | undefined>>;

function booleanSetting(
  value: string | undefined,
  fallback: boolean,
  error: OnlineOpsConfigurationError,
  errors: OnlineOpsConfigurationError[],
): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  errors.push(error);
  return fallback;
}

function integerSetting(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  error: OnlineOpsConfigurationError,
  errors: OnlineOpsConfigurationError[],
): number {
  if (value === undefined) return fallback;
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    errors.push(error);
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    errors.push(error);
    return fallback;
  }
  return parsed;
}

function sourceRevisionSetting(
  value: string | undefined,
  required: boolean,
  errors: OnlineOpsConfigurationError[],
): string | null {
  if (value === undefined || value === "") {
    if (required) errors.push("missing-source-revision");
    return null;
  }
  if (!/^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(value)) {
    errors.push("invalid-source-revision");
    return null;
  }
  return value.toLowerCase();
}

export function sanitizedRailwayIdentifier(
  value: string | undefined,
): string | null {
  if (value === undefined || value === "") return null;
  // Railway does not promise one identifier format. Keep only bounded,
  // non-whitespace printable ASCII and sanitize all other provider values to
  // null without changing readiness or ops-route availability.
  if (value.length > 128 || !/^[\x21-\x7e]+$/.test(value)) return null;
  return value;
}

function authenticatorSetting(
  token: string | undefined,
  required: boolean,
  errors: OnlineOpsConfigurationError[],
): OpsBearerAuthenticator | null {
  if (token === undefined || token === "") {
    if (required) errors.push("missing-token");
    return null;
  }
  if (!isValidOpsToken(token)) {
    errors.push("invalid-token");
    return null;
  }
  return new OpsBearerAuthenticator(token);
}

/**
 * Parse server ops environment without preserving secret input.
 *
 * Invalid optional configuration disables the affected capability but does
 * not make an otherwise public local server unready. When ops is required,
 * any configuration error is surfaced through `readinessBlocked` so later
 * `/readyz` wiring can fail closed without exposing the error or raw value.
 */
export function readOnlineOpsConfiguration(
  environment: Environment = process.env,
): OnlineOpsConfigurationStatus {
  const errors: OnlineOpsConfigurationError[] = [];
  const required = booleanSetting(
    environment.ONLINE_OPS_REQUIRED,
    false,
    "invalid-ops-required",
    errors,
  );
  const maintenanceNoticesEnabled = booleanSetting(
    environment.ONLINE_MAINTENANCE_NOTICES_ENABLED,
    false,
    "invalid-maintenance-notices-enabled",
    errors,
  );
  const reconnectGraceMs = integerSetting(
    environment.ONLINE_DRAIN_RECONNECT_GRACE_MS,
    ONLINE_DRAIN_RECONNECT_GRACE_DEFAULT_MS,
    ONLINE_DRAIN_RECONNECT_GRACE_MIN_MS,
    ONLINE_DRAIN_RECONNECT_GRACE_MAX_MS,
    "invalid-reconnect-grace",
    errors,
  );
  let shutdownGraceMs = integerSetting(
    environment.ONLINE_SHUTDOWN_GRACE_MS,
    ONLINE_SHUTDOWN_GRACE_DEFAULT_MS,
    ONLINE_SHUTDOWN_GRACE_MIN_MS,
    ONLINE_SHUTDOWN_GRACE_MAX_MS,
    "invalid-shutdown-grace",
    errors,
  );
  let socketCloseGraceMs = integerSetting(
    environment.ONLINE_SOCKET_CLOSE_GRACE_MS,
    ONLINE_SOCKET_CLOSE_GRACE_DEFAULT_MS,
    ONLINE_SOCKET_CLOSE_GRACE_MIN_MS,
    ONLINE_SOCKET_CLOSE_GRACE_MAX_MS,
    "invalid-socket-close-grace",
    errors,
  );
  if (socketCloseGraceMs >= shutdownGraceMs) {
    errors.push("socket-close-grace-not-less-than-shutdown");
    // Keep the lifecycle controller constructible so `/healthz` and `/readyz`
    // can report the invalid configuration instead of crashing at startup.
    // `valid`/`readinessBlocked` still preserve the fail-closed contract.
    shutdownGraceMs = ONLINE_SHUTDOWN_GRACE_DEFAULT_MS;
    socketCloseGraceMs = ONLINE_SOCKET_CLOSE_GRACE_DEFAULT_MS;
  }

  const authenticator = authenticatorSetting(
    environment.ONLINE_OPS_TOKEN,
    required,
    errors,
  );
  const sourceRevision = sourceRevisionSetting(
    environment.ONLINE_SOURCE_REVISION,
    required,
    errors,
  );
  const deploymentId = sanitizedRailwayIdentifier(
    environment.RAILWAY_DEPLOYMENT_ID,
  );
  const replicaId = sanitizedRailwayIdentifier(environment.RAILWAY_REPLICA_ID);
  const valid = errors.length === 0;
  // A malformed required flag is not equivalent to an explicit opt-out: a
  // production typo such as `TRUE` must not silently make the deployment
  // ready with its private safety boundary disabled.
  const readinessBlocked =
    !valid && (required || errors.includes("invalid-ops-required"));
  const config = Object.freeze({
    required,
    maintenanceNoticesEnabled,
    authenticator,
    sourceRevision,
    deploymentId,
    replicaId,
    reconnectGraceMs,
    shutdownGraceMs,
    socketCloseGraceMs,
  });
  return Object.freeze({
    config,
    errors: Object.freeze([...errors]),
    opsRoutesAvailable: valid && authenticator !== null,
    readinessBlocked,
    valid,
  });
}
