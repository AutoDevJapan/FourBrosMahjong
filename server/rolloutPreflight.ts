import {
  ONLINE_SHUTDOWN_GRACE_MAX_MS,
  ONLINE_SHUTDOWN_GRACE_MIN_MS,
  sanitizedRailwayIdentifier,
} from "./opsConfig";

export const ONLINE_DIRECT_START_COMMAND =
  "node --import tsx server/start.ts" as const;
export const ROLLOUT_EVIDENCE_MAX_AGE_MS = 5 * 60 * 1_000;
export const ROLLOUT_EVIDENCE_MAX_FUTURE_SKEW_MS = 30 * 1_000;

type RolloutPreflightReason =
  | "active-deployment-source-mismatch"
  | "active-deployment-not-successful"
  | "client-evidence-invalid"
  | "client-evidence-not-fresh"
  | "client-source-mismatch"
  | "drain-not-ready"
  | "draining-duration-insufficient"
  | "effective-command-not-direct-node"
  | "evidence-from-future"
  | "evidence-not-fresh"
  | "evidence-capture-skew"
  | "healthcheck-not-readyz"
  | "invalid-schema"
  | "maintenance-phase-mismatch"
  | "ops-not-required"
  | "ops-deployment-mismatch"
  | "ops-replica-identity-invalid"
  | "ops-replica-mismatch"
  | "ops-source-mismatch"
  | "readiness-status-mismatch"
  | "deployment-set-not-stable"
  | "replica-count-not-one"
  | "replica-scope-not-all-regions"
  | "replica-topology-invalid"
  | "rollback-config-invalid"
  | "rollback-not-available"
  | "shutdown-grace-invalid"
  | "source-revision-invalid"
  | "target-identity-invalid";

export interface RolloutPreflightResult {
  readonly schemaVersion: 1;
  readonly repoPreflight: "hold" | "pass";
  /** A repository-local check never grants production authority. */
  readonly authorizesDeployment: false;
  /** The validator performs no Railway, deploy, config, or flag mutation. */
  readonly externalMutationPerformed: false;
  readonly reasons: readonly RolloutPreflightReason[];
}

const ROOT_KEYS = [
  "schemaVersion",
  "phase",
  "capturedAt",
  "railwayObservedAt",
  "target",
  "rollback",
  "runtime",
  "source",
  "client",
  "operations",
] as const;
const TARGET_KEYS = [
  "projectId",
  "serviceId",
  "environmentId",
  "activeDeploymentId",
  "activeDeploymentStatus",
  "deploymentSet",
] as const;
const DEPLOYMENT_SET_KEYS = [
  "activeDeploymentId",
  "inProgressDeploymentIds",
  "stagedChanges",
] as const;
const ROLLBACK_KEYS = [
  "role",
  "deploymentId",
  "sourceProvenance",
  "retentionEligible",
  "effectiveStartCommand",
  "effectiveHealthcheckPath",
  "effectiveDrainingSeconds",
  "shutdownGraceMs",
  "onlineOpsRequired",
  "maintenanceNoticesEnabled",
] as const;
const RUNTIME_KEYS = [
  "replicaScope",
  "regions",
  "effectiveStartCommand",
  "effectiveHealthcheckPath",
  "effectiveDrainingSeconds",
  "shutdownGraceMs",
] as const;
const REGION_KEYS = ["regionId", "replicaIds"] as const;
const ROLLBACK_GIT_SOURCE_KEYS = ["kind", "fullRevision"] as const;
const SOURCE_KEYS = [
  "reviewedServerRevision",
  "activeDeploymentRevision",
  "opsStatusSourceRevision",
] as const;
const CLIENT_KEYS = [
  "reviewedRevision",
  "productionRevision",
  "deploymentId",
  "observedAt",
  "compatibilityEvidenceUrls",
] as const;
const OPERATIONS_KEYS = [
  "onlineOpsRequired",
  "maintenanceNoticesEnabled",
  "readyzStatus",
  "drainState",
  "blockingDrainRooms",
  "reconnectGraceRooms",
  "opsStatusDeploymentId",
  "opsStatusReplicaId",
  "observedAt",
  "acceptingReadiness",
] as const;
const ACCEPTING_READINESS_KEYS = [
  "observedAt",
  "deploymentId",
  "sourceRevision",
  "readyzStatus",
] as const;

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

function isOpaqueIdentifier(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const sanitized = sanitizedRailwayIdentifier(value);
  // Provider/CLI placeholders are not evidence of a read-back identity.
  return sanitized !== null && sanitized.toLowerCase() !== "unknown";
}

function isFullRevision(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(value)
  );
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
  try {
    return new Date(time).toISOString() === value ? time : null;
  } catch {
    return null;
  }
}

function isSanitizedEvidenceUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.port === "" &&
      /^\/AutoDevJapan\/FourBrosMahjong\/(?:issues|pull)\/\d+$/.test(
        url.pathname,
      ) &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function isNonNegativeCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isRollbackSourceProvenance(value: unknown): value is UnknownRecord {
  if (!isRecord(value)) return false;
  if (value.kind === "railway-git-commit") {
    return (
      hasExactKeys(value, ROLLBACK_GIT_SOURCE_KEYS) &&
      isFullRevision(value.fullRevision)
    );
  }
  return false;
}

function fixedResult(
  reasons: Iterable<RolloutPreflightReason>,
): RolloutPreflightResult {
  const stableReasons = Object.freeze([...new Set(reasons)]);
  return Object.freeze({
    schemaVersion: 1,
    repoPreflight: stableReasons.length === 0 ? "pass" : "hold",
    authorizesDeployment: false,
    externalMutationPerformed: false,
    reasons: stableReasons,
  });
}

/**
 * Validate operator-normalized, sanitized read-back evidence without making an
 * external request or retaining/returning any supplied identifier.
 *
 * A pass is only one repository-local rollout gate. It does not authenticate
 * the evidence, approve maintenance, prove current room load, or authorize a
 * Railway/config/deployment operation.
 */
export function validateOnlineRolloutPreflight(
  evidence: unknown,
  nowMs: number = Date.now(),
): RolloutPreflightResult {
  if (!Number.isFinite(nowMs) || nowMs < 0) {
    throw new RangeError(
      "rollout preflight clock must be finite and nonnegative",
    );
  }

  if (
    !hasExactKeys(evidence, ROOT_KEYS) ||
    !hasExactKeys(evidence.target, TARGET_KEYS) ||
    !hasExactKeys(evidence.target.deploymentSet, DEPLOYMENT_SET_KEYS) ||
    !hasExactKeys(evidence.rollback, ROLLBACK_KEYS) ||
    !isRollbackSourceProvenance(evidence.rollback.sourceProvenance) ||
    !hasExactKeys(evidence.runtime, RUNTIME_KEYS) ||
    !hasExactKeys(evidence.source, SOURCE_KEYS) ||
    !hasExactKeys(evidence.client, CLIENT_KEYS) ||
    !hasExactKeys(evidence.operations, OPERATIONS_KEYS) ||
    !hasExactKeys(
      evidence.operations.acceptingReadiness,
      ACCEPTING_READINESS_KEYS,
    ) ||
    evidence.schemaVersion !== 1 ||
    (evidence.phase !== "pre-enable" &&
      evidence.phase !== "pre-drain" &&
      evidence.phase !== "drained")
  ) {
    return fixedResult(["invalid-schema"]);
  }

  const target = evidence.target;
  const rollback = evidence.rollback;
  const runtime = evidence.runtime;
  const source = evidence.source;
  const client = evidence.client;
  const operations = evidence.operations;
  const targetDeploymentSet = target.deploymentSet as UnknownRecord;
  const rollbackSource = rollback.sourceProvenance as UnknownRecord;
  const acceptingReadiness = operations.acceptingReadiness as UnknownRecord;
  const reasons: RolloutPreflightReason[] = [];

  const capturedAt = timestampMs(evidence.capturedAt);
  if (capturedAt === null) {
    reasons.push("invalid-schema");
  } else if (capturedAt > nowMs + ROLLOUT_EVIDENCE_MAX_FUTURE_SKEW_MS) {
    reasons.push("evidence-from-future");
  } else if (nowMs - capturedAt > ROLLOUT_EVIDENCE_MAX_AGE_MS) {
    reasons.push("evidence-not-fresh");
  }
  const railwayObservedAt = timestampMs(evidence.railwayObservedAt);
  if (railwayObservedAt === null) {
    reasons.push("invalid-schema");
  } else if (
    railwayObservedAt > nowMs + ROLLOUT_EVIDENCE_MAX_FUTURE_SKEW_MS ||
    nowMs - railwayObservedAt > ROLLOUT_EVIDENCE_MAX_AGE_MS
  ) {
    reasons.push("evidence-not-fresh");
  }

  if (
    !isOpaqueIdentifier(target.projectId) ||
    !isOpaqueIdentifier(target.serviceId) ||
    !isOpaqueIdentifier(target.environmentId) ||
    !isOpaqueIdentifier(target.activeDeploymentId)
  ) {
    reasons.push("target-identity-invalid");
  }
  if (
    rollback.role !== "prospective-after-approved-change" ||
    !isOpaqueIdentifier(rollback.deploymentId) ||
    rollback.deploymentId !== target.activeDeploymentId ||
    !isRollbackSourceProvenance(rollback.sourceProvenance) ||
    rollback.retentionEligible !== true
  ) {
    reasons.push("rollback-not-available");
  }
  if (target.activeDeploymentStatus !== "success") {
    reasons.push("active-deployment-not-successful");
  }
  if (
    targetDeploymentSet.activeDeploymentId !== target.activeDeploymentId ||
    !Array.isArray(targetDeploymentSet.inProgressDeploymentIds) ||
    targetDeploymentSet.inProgressDeploymentIds.length !== 0 ||
    targetDeploymentSet.stagedChanges !== false
  ) {
    reasons.push("deployment-set-not-stable");
  }

  if (runtime.replicaScope !== "all-regions") {
    reasons.push("replica-scope-not-all-regions");
  }
  const regions = Array.isArray(runtime.regions) ? runtime.regions : [];
  const replicaTopologyValid =
    Array.isArray(runtime.regions) &&
    regions.every(
      (region) =>
        hasExactKeys(region, REGION_KEYS) &&
        isOpaqueIdentifier(region.regionId) &&
        Array.isArray(region.replicaIds) &&
        region.replicaIds.every(isOpaqueIdentifier),
    ) &&
    new Set(
      regions.map((region) => (isRecord(region) ? region.regionId : undefined)),
    ).size === regions.length;
  const replicaIds = replicaTopologyValid
    ? regions.flatMap((region) => region.replicaIds as string[])
    : [];
  const replicaIdsUnique = new Set(replicaIds).size === replicaIds.length;
  if (!replicaTopologyValid) {
    reasons.push("replica-topology-invalid");
  }
  if (replicaTopologyValid && !replicaIdsUnique) {
    reasons.push("replica-topology-invalid");
  }
  if (replicaIds.length !== 1) {
    reasons.push("replica-count-not-one");
  }
  if (runtime.effectiveStartCommand !== ONLINE_DIRECT_START_COMMAND) {
    reasons.push("effective-command-not-direct-node");
  }
  if (runtime.effectiveHealthcheckPath !== "/readyz") {
    reasons.push("healthcheck-not-readyz");
  }
  if (
    !Number.isSafeInteger(runtime.shutdownGraceMs) ||
    (runtime.shutdownGraceMs as number) < ONLINE_SHUTDOWN_GRACE_MIN_MS ||
    (runtime.shutdownGraceMs as number) > ONLINE_SHUTDOWN_GRACE_MAX_MS
  ) {
    reasons.push("shutdown-grace-invalid");
  } else {
    const minimumDrainingSeconds =
      Math.ceil((runtime.shutdownGraceMs as number) / 1_000) + 5;
    if (
      !Number.isSafeInteger(runtime.effectiveDrainingSeconds) ||
      (runtime.effectiveDrainingSeconds as number) < minimumDrainingSeconds
    ) {
      reasons.push("draining-duration-insufficient");
    }
  }

  const rollbackShutdownGraceMs = rollback.shutdownGraceMs;
  const rollbackMinimumDrainingSeconds =
    Number.isSafeInteger(rollbackShutdownGraceMs) &&
    (rollbackShutdownGraceMs as number) >= ONLINE_SHUTDOWN_GRACE_MIN_MS &&
    (rollbackShutdownGraceMs as number) <= ONLINE_SHUTDOWN_GRACE_MAX_MS
      ? Math.ceil((rollbackShutdownGraceMs as number) / 1_000) + 5
      : null;
  if (
    rollback.effectiveStartCommand !== ONLINE_DIRECT_START_COMMAND ||
    rollback.effectiveHealthcheckPath !== "/readyz" ||
    rollbackMinimumDrainingSeconds === null ||
    !Number.isSafeInteger(rollback.effectiveDrainingSeconds) ||
    (rollback.effectiveDrainingSeconds as number) <
      rollbackMinimumDrainingSeconds ||
    rollback.onlineOpsRequired !== true ||
    rollback.onlineOpsRequired !== operations.onlineOpsRequired ||
    rollback.maintenanceNoticesEnabled !== (evidence.phase !== "pre-enable") ||
    rollback.effectiveStartCommand !== runtime.effectiveStartCommand ||
    rollback.effectiveHealthcheckPath !== runtime.effectiveHealthcheckPath ||
    rollback.effectiveDrainingSeconds !== runtime.effectiveDrainingSeconds ||
    rollback.shutdownGraceMs !== runtime.shutdownGraceMs ||
    !revisionsMatch(
      rollbackSource.fullRevision,
      source.activeDeploymentRevision,
    )
  ) {
    reasons.push("rollback-config-invalid");
  }

  if (
    !isFullRevision(source.reviewedServerRevision) ||
    !isFullRevision(source.activeDeploymentRevision) ||
    !isFullRevision(source.opsStatusSourceRevision)
  ) {
    reasons.push("source-revision-invalid");
  } else {
    if (
      !revisionsMatch(
        source.reviewedServerRevision,
        source.activeDeploymentRevision,
      )
    ) {
      reasons.push("active-deployment-source-mismatch");
    }
    if (
      !revisionsMatch(
        source.reviewedServerRevision,
        source.opsStatusSourceRevision,
      )
    ) {
      reasons.push("ops-source-mismatch");
    }
  }

  const clientObservedAt = timestampMs(client.observedAt);
  if (
    !isOpaqueIdentifier(client.deploymentId) ||
    !Array.isArray(client.compatibilityEvidenceUrls) ||
    client.compatibilityEvidenceUrls.length !== 2 ||
    client.compatibilityEvidenceUrls[0] !==
      "https://github.com/AutoDevJapan/FourBrosMahjong/pull/729" ||
    client.compatibilityEvidenceUrls[1] !==
      "https://github.com/AutoDevJapan/FourBrosMahjong/pull/730" ||
    !client.compatibilityEvidenceUrls.every(isSanitizedEvidenceUrl) ||
    clientObservedAt === null
  ) {
    reasons.push("client-evidence-invalid");
  } else if (
    clientObservedAt > nowMs + ROLLOUT_EVIDENCE_MAX_FUTURE_SKEW_MS ||
    nowMs - clientObservedAt > ROLLOUT_EVIDENCE_MAX_AGE_MS
  ) {
    reasons.push("client-evidence-not-fresh");
  }
  if (
    !isFullRevision(client.reviewedRevision) ||
    !isFullRevision(client.productionRevision)
  ) {
    reasons.push("source-revision-invalid");
  } else if (
    !revisionsMatch(client.reviewedRevision, client.productionRevision)
  ) {
    reasons.push("client-source-mismatch");
  }

  if (operations.onlineOpsRequired !== true) {
    reasons.push("ops-not-required");
  }
  if (
    !isOpaqueIdentifier(operations.opsStatusDeploymentId) ||
    operations.opsStatusDeploymentId !== target.activeDeploymentId
  ) {
    reasons.push("ops-deployment-mismatch");
  }
  if (!isOpaqueIdentifier(operations.opsStatusReplicaId)) {
    reasons.push("ops-replica-identity-invalid");
  } else if (
    replicaTopologyValid &&
    replicaIdsUnique &&
    replicaIds.length === 1 &&
    operations.opsStatusReplicaId !== replicaIds[0]
  ) {
    reasons.push("ops-replica-mismatch");
  }
  const accepting = evidence.phase !== "drained";
  if (
    operations.maintenanceNoticesEnabled !==
    (evidence.phase !== "pre-enable")
  ) {
    reasons.push("maintenance-phase-mismatch");
  }
  const expectedReadinessStatus = accepting ? 200 : 503;
  if (operations.readyzStatus !== expectedReadinessStatus) {
    reasons.push("readiness-status-mismatch");
  }
  const expectedDrainState = accepting ? "accepting" : "drained";
  if (operations.drainState !== expectedDrainState) {
    reasons.push("maintenance-phase-mismatch");
  }
  if (
    !isNonNegativeCount(operations.blockingDrainRooms) ||
    !isNonNegativeCount(operations.reconnectGraceRooms)
  ) {
    reasons.push("invalid-schema");
  } else if (
    !accepting &&
    (operations.blockingDrainRooms !== 0 ||
      operations.reconnectGraceRooms !== 0)
  ) {
    reasons.push("drain-not-ready");
  }

  const operationsObservedAt = timestampMs(operations.observedAt);
  const acceptingObservedAt = timestampMs(acceptingReadiness.observedAt);
  if (
    operationsObservedAt === null ||
    acceptingObservedAt === null ||
    operationsObservedAt > nowMs + ROLLOUT_EVIDENCE_MAX_FUTURE_SKEW_MS ||
    acceptingObservedAt > nowMs + ROLLOUT_EVIDENCE_MAX_FUTURE_SKEW_MS ||
    nowMs - operationsObservedAt > ROLLOUT_EVIDENCE_MAX_AGE_MS ||
    nowMs - acceptingObservedAt > ROLLOUT_EVIDENCE_MAX_AGE_MS
  ) {
    reasons.push("evidence-not-fresh");
  } else {
    if (
      railwayObservedAt !== null &&
      Math.abs(railwayObservedAt - operationsObservedAt) >
        ROLLOUT_EVIDENCE_MAX_FUTURE_SKEW_MS
    ) {
      reasons.push("evidence-capture-skew");
    }
    if (
      acceptingObservedAt > operationsObservedAt ||
      (evidence.phase !== "drained" &&
        acceptingObservedAt !== operationsObservedAt) ||
      (evidence.phase === "drained" &&
        acceptingObservedAt >= operationsObservedAt) ||
      operationsObservedAt - acceptingObservedAt > ROLLOUT_EVIDENCE_MAX_AGE_MS
    ) {
      reasons.push("evidence-capture-skew");
    }
  }
  if (
    acceptingReadiness.deploymentId !== target.activeDeploymentId ||
    !revisionsMatch(
      acceptingReadiness.sourceRevision,
      source.reviewedServerRevision,
    ) ||
    acceptingReadiness.readyzStatus !== 200
  ) {
    reasons.push("readiness-status-mismatch");
  }

  return fixedResult(reasons);
}
