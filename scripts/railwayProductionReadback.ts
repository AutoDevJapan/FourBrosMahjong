import { isIP } from "node:net";
import { sanitizedRailwayIdentifier } from "../server/opsConfig";

/** A production read-back is useful only while its provider state is fresh. */
export const RAILWAY_PRODUCTION_READBACK_MAX_AGE_MS = 5 * 60 * 1_000;
export const RAILWAY_PRODUCTION_READBACK_MAX_FUTURE_SKEW_MS = 30 * 1_000;

type RailwayProductionReadbackReason =
  | "allowed-origin-invalid"
  | "deployment-not-successful"
  | "evidence-capture-skew"
  | "evidence-from-future"
  | "evidence-not-fresh"
  | "healthcheck-mismatch"
  | "invalid-schema"
  | "port-invalid"
  | "probe-invalid"
  | "probe-not-passing"
  | "probe-origin-mismatch"
  | "probe-target-mismatch"
  | "source-revision-invalid"
  | "source-revision-mismatch"
  | "target-identity-invalid"
  | "target-url-invalid";

export interface RailwayProductionReadbackResult {
  readonly schemaVersion: 1;
  readonly readback: "hold" | "pass";
  /** A local validator never grants authority to mutate Railway. */
  readonly authorizesDeployment: false;
  /** The validator performs no provider request or external mutation. */
  readonly externalMutationPerformed: false;
  readonly reasons: readonly RailwayProductionReadbackReason[];
}

const ROOT_KEYS = [
  "schemaVersion",
  "capturedAt",
  "operator",
  "target",
  "configuration",
  "reviewedSourceRevision",
  "probe",
] as const;
const OPERATOR_KEYS = ["name", "timezone"] as const;
const TARGET_KEYS = [
  "projectId",
  "serviceId",
  "environmentId",
  "deploymentId",
  "deploymentStatus",
  "sourceRevision",
  "publicBaseUrl",
  "healthcheckPath",
  "port",
] as const;
const CONFIGURATION_KEYS = ["allowedOrigin"] as const;
const PROBE_KEYS = [
  "schemaVersion",
  "ok",
  "startedAt",
  "finishedAt",
  "baseUrl",
  "checks",
] as const;
const PROBE_CHECKS_KEYS = [
  "health",
  "readiness",
  "allowedOrigin",
  "disallowedOrigin",
  "missingOrigin",
] as const;
const HEALTH_CHECK_KEYS = [
  "expectedStatus",
  "startedAt",
  "statusCode",
  "body",
] as const;
const ORIGIN_CHECK_KEYS = [
  "origin",
  "expectedStatus",
  "startedAt",
  "statusCode",
] as const;
const MISSING_ORIGIN_CHECK_KEYS = [
  "expectedStatus",
  "startedAt",
  "statusCode",
] as const;
const HEALTH_BODY_KEYS = ["ok"] as const;
const PUBLIC_HOST_BLOCKLIST = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data.ec2.internal",
]);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: unknown,
  keys: readonly string[],
): value is UnknownRecord {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isSafeLabel(value: unknown, maxLength: number): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    return false;
  }
  if (value.trim() !== value) return false;
  return [...value].every((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && codePoint >= 0x20 && codePoint !== 0x7f;
  });
}

function isOpaqueIdentifier(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const sanitized = sanitizedRailwayIdentifier(value);
  return sanitized !== null && sanitized.toLowerCase() !== "unknown";
}

function isFullRevision(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-fA-F]{40}$/.test(value);
}

function revisionsMatch(left: unknown, right: unknown): boolean {
  return (
    isFullRevision(left) &&
    isFullRevision(right) &&
    left.toLowerCase() === right.toLowerCase()
  );
}

function timestampMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString() === value ? time : null;
}

function isExactOrigin(value: unknown, requireHttps: boolean): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      (requireHttps && url.protocol !== "https:") ||
      url.origin !== value ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== ""
    ) {
      return false;
    }
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    return (
      hostname.length > 0 &&
      hostname.includes(".") &&
      !hostname.includes("*") &&
      isIP(hostname) === 0 &&
      !PUBLIC_HOST_BLOCKLIST.has(hostname) &&
      !hostname.endsWith(".localhost") &&
      !hostname.endsWith(".local") &&
      !hostname.endsWith(".internal")
    );
  } catch {
    return false;
  }
}

function isPort(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 1 &&
    (value as number) <= 65_535
  );
}

function fixedResult(
  reasons: Iterable<RailwayProductionReadbackReason>,
): RailwayProductionReadbackResult {
  const stableReasons = Object.freeze([...new Set(reasons)]);
  return Object.freeze({
    schemaVersion: 1,
    readback: stableReasons.length === 0 ? "pass" : "hold",
    authorizesDeployment: false,
    externalMutationPerformed: false,
    reasons: stableReasons,
  });
}

/**
 * Validate one operator-normalized Railway production read-back offline.
 *
 * The accepted input is deliberately a small exact-key schema. In particular,
 * it carries one effective allowed origin instead of an environment dump, and
 * the returned result never reflects any supplied ID, URL, or operator value.
 * A pass proves only internal consistency and freshness; it does not
 * authenticate the operator or authorize a deployment.
 */
export function validateRailwayProductionReadback(
  evidence: unknown,
  nowMs: number = Date.now(),
): RailwayProductionReadbackResult {
  if (!Number.isFinite(nowMs) || nowMs < 0) {
    throw new RangeError(
      "production read-back clock must be finite and nonnegative",
    );
  }

  if (
    !hasExactKeys(evidence, ROOT_KEYS) ||
    evidence.schemaVersion !== 1 ||
    !hasExactKeys(evidence.operator, OPERATOR_KEYS) ||
    !hasExactKeys(evidence.target, TARGET_KEYS) ||
    !hasExactKeys(evidence.configuration, CONFIGURATION_KEYS) ||
    !hasExactKeys(evidence.probe, PROBE_KEYS) ||
    !hasExactKeys(evidence.probe.checks, PROBE_CHECKS_KEYS) ||
    !hasExactKeys(evidence.probe.checks.health, HEALTH_CHECK_KEYS) ||
    !hasExactKeys(evidence.probe.checks.health.body, HEALTH_BODY_KEYS) ||
    !hasExactKeys(evidence.probe.checks.readiness, HEALTH_CHECK_KEYS) ||
    !hasExactKeys(evidence.probe.checks.readiness.body, HEALTH_BODY_KEYS) ||
    !hasExactKeys(evidence.probe.checks.allowedOrigin, ORIGIN_CHECK_KEYS) ||
    !hasExactKeys(evidence.probe.checks.disallowedOrigin, ORIGIN_CHECK_KEYS) ||
    !hasExactKeys(
      evidence.probe.checks.missingOrigin,
      MISSING_ORIGIN_CHECK_KEYS,
    )
  ) {
    return fixedResult(["invalid-schema"]);
  }

  const operator = evidence.operator as UnknownRecord;
  const target = evidence.target as UnknownRecord;
  const configuration = evidence.configuration as UnknownRecord;
  const probe = evidence.probe as UnknownRecord;
  const checks = probe.checks as UnknownRecord;
  const health = checks.health as UnknownRecord;
  const readiness = checks.readiness as UnknownRecord;
  const allowedOrigin = checks.allowedOrigin as UnknownRecord;
  const disallowedOrigin = checks.disallowedOrigin as UnknownRecord;
  const missingOrigin = checks.missingOrigin as UnknownRecord;
  const reasons: RailwayProductionReadbackReason[] = [];

  const capturedAt = timestampMs(evidence.capturedAt);
  if (capturedAt === null) {
    reasons.push("invalid-schema");
  } else if (
    capturedAt >
    nowMs + RAILWAY_PRODUCTION_READBACK_MAX_FUTURE_SKEW_MS
  ) {
    reasons.push("evidence-from-future");
  } else if (nowMs - capturedAt > RAILWAY_PRODUCTION_READBACK_MAX_AGE_MS) {
    reasons.push("evidence-not-fresh");
  }

  if (!isSafeLabel(operator.name, 128) || !isSafeLabel(operator.timezone, 64)) {
    reasons.push("invalid-schema");
  }

  const targetIdentifiers = [
    target.projectId,
    target.serviceId,
    target.environmentId,
    target.deploymentId,
  ];
  if (!targetIdentifiers.every(isOpaqueIdentifier)) {
    reasons.push("target-identity-invalid");
  }
  if (!isExactOrigin(target.publicBaseUrl, true)) {
    reasons.push("target-url-invalid");
  }
  if (target.deploymentStatus !== "success") {
    reasons.push("deployment-not-successful");
  }
  if (target.healthcheckPath !== "/readyz") {
    reasons.push("healthcheck-mismatch");
  }
  if (!isPort(target.port)) {
    reasons.push("port-invalid");
  }

  if (!isFullRevision(evidence.reviewedSourceRevision)) {
    reasons.push("source-revision-invalid");
  }
  if (!isFullRevision(target.sourceRevision)) {
    reasons.push("source-revision-invalid");
  }
  if (
    isFullRevision(evidence.reviewedSourceRevision) &&
    isFullRevision(target.sourceRevision) &&
    !revisionsMatch(evidence.reviewedSourceRevision, target.sourceRevision)
  ) {
    reasons.push("source-revision-mismatch");
  }

  if (!isExactOrigin(configuration.allowedOrigin, true)) {
    reasons.push("allowed-origin-invalid");
  }

  const probeStartedAt = timestampMs(probe.startedAt);
  const probeFinishedAt = timestampMs(probe.finishedAt);
  if (
    probe.schemaVersion !== 2 ||
    probe.ok !== true ||
    probeStartedAt === null ||
    probeFinishedAt === null ||
    probeFinishedAt < probeStartedAt
  ) {
    reasons.push("probe-invalid");
  } else {
    if (
      probeFinishedAt >
      nowMs + RAILWAY_PRODUCTION_READBACK_MAX_FUTURE_SKEW_MS
    ) {
      reasons.push("evidence-from-future");
    }
    if (capturedAt !== null && capturedAt < probeFinishedAt) {
      reasons.push("evidence-capture-skew");
    }
    const checkStartedAt = [
      health.startedAt,
      readiness.startedAt,
      allowedOrigin.startedAt,
      disallowedOrigin.startedAt,
      missingOrigin.startedAt,
    ].map(timestampMs);
    if (
      checkStartedAt.some(
        (startedAt) =>
          startedAt === null ||
          startedAt < probeStartedAt ||
          startedAt > probeFinishedAt,
      )
    ) {
      reasons.push("probe-invalid");
    }
  }

  if (probe.baseUrl !== target.publicBaseUrl) {
    reasons.push("probe-target-mismatch");
  }
  const healthPassed =
    health.expectedStatus === 200 &&
    health.statusCode === 200 &&
    (health.body as UnknownRecord).ok === true;
  const readinessPassed =
    readiness.expectedStatus === 200 &&
    readiness.statusCode === 200 &&
    (readiness.body as UnknownRecord).ok === true;
  const allowedPassed =
    allowedOrigin.expectedStatus === 101 && allowedOrigin.statusCode === 101;
  const disallowedPassed =
    disallowedOrigin.expectedStatus === 403 &&
    disallowedOrigin.statusCode === 403;
  const missingPassed =
    missingOrigin.expectedStatus === 403 && missingOrigin.statusCode === 403;
  if (
    probe.ok !== true ||
    !healthPassed ||
    !readinessPassed ||
    !allowedPassed ||
    !disallowedPassed ||
    !missingPassed
  ) {
    reasons.push("probe-not-passing");
  }

  if (
    allowedOrigin.origin !== configuration.allowedOrigin ||
    allowedOrigin.origin === disallowedOrigin.origin ||
    !isExactOrigin(allowedOrigin.origin, true) ||
    !isExactOrigin(disallowedOrigin.origin, true)
  ) {
    reasons.push("probe-origin-mismatch");
  }

  return fixedResult(reasons);
}
