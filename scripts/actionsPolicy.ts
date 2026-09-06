const ACTIONS_POLICY_SCHEMA_VERSION = 1 as const;
export const ACTIONS_POLICY_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const ACTIONS_POLICY_MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

const EXPECTED_ORGANIZATION = "AutoDevJapan";
const EXPECTED_REPOSITORY = "FourBrosMahjong";
const ALLOWED_ACTIONS = new Set(["all", "selected", "local_only"]);
const VERIFICATION_STATUSES = new Set(["success", "not-run"]);

const EVIDENCE_KEYS = [
  "capturedAt",
  "policy",
  "scope",
  "schemaVersion",
  "verification",
  "workflowAudit",
] as const;
const POLICY_KEYS = [
  "allowedActions",
  "enabled",
  "shaPinningRequired",
] as const;
const SCOPE_KEYS = ["effectiveScope", "organization", "repository"] as const;
const AUDIT_KEYS = [
  "externalReferenceCount",
  "localReferenceCount",
  "unpinnedReferenceCount",
] as const;
const VERIFICATION_KEYS = [
  "ci",
  "codeql",
  "gitleaks",
  "release",
  "updater",
] as const;

type EffectiveScope = "organization" | "repository" | "unknown";
type VerificationStatus = "not-run" | "success";

interface ActionsPolicyEvidence {
  readonly capturedAt: string;
  readonly policy: {
    readonly allowedActions: "all" | "local_only" | "selected";
    readonly enabled: boolean;
    readonly shaPinningRequired: boolean;
  };
  readonly scope: {
    readonly effectiveScope: EffectiveScope;
    readonly organization: string;
    readonly repository: string;
  };
  readonly schemaVersion: typeof ACTIONS_POLICY_SCHEMA_VERSION;
  readonly verification: {
    readonly ci: VerificationStatus;
    readonly codeql: VerificationStatus;
    readonly gitleaks: VerificationStatus;
    readonly release: VerificationStatus;
    readonly updater: VerificationStatus;
  };
  readonly workflowAudit: {
    readonly externalReferenceCount: number;
    readonly localReferenceCount: number;
    readonly unpinnedReferenceCount: number;
  };
}

export interface ActionsPolicyValidation {
  readonly authorizesMutation: false;
  readonly externalMutationPerformed: false;
  readonly policy: "hold" | "pass";
  readonly reasons: readonly string[];
  readonly schemaVersion: typeof ACTIONS_POLICY_SCHEMA_VERSION;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort()[index])
  );
}

function isSafeCount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 1_000
  );
}

function isVerificationStatus(value: unknown): value is VerificationStatus {
  return typeof value === "string" && VERIFICATION_STATUSES.has(value);
}

function isEvidenceShape(value: unknown): value is ActionsPolicyEvidence {
  if (!isRecord(value) || !hasExactKeys(value, EVIDENCE_KEYS)) return false;
  if (value.schemaVersion !== ACTIONS_POLICY_SCHEMA_VERSION) return false;
  if (
    typeof value.capturedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.capturedAt)
  ) {
    return false;
  }

  if (!isRecord(value.scope) || !hasExactKeys(value.scope, SCOPE_KEYS)) {
    return false;
  }
  if (
    value.scope.organization !== EXPECTED_ORGANIZATION ||
    value.scope.repository !== EXPECTED_REPOSITORY ||
    !["organization", "repository", "unknown"].includes(
      value.scope.effectiveScope as string,
    )
  ) {
    return false;
  }

  if (!isRecord(value.policy) || !hasExactKeys(value.policy, POLICY_KEYS)) {
    return false;
  }
  if (
    typeof value.policy.enabled !== "boolean" ||
    typeof value.policy.shaPinningRequired !== "boolean" ||
    typeof value.policy.allowedActions !== "string" ||
    !ALLOWED_ACTIONS.has(value.policy.allowedActions)
  ) {
    return false;
  }

  if (
    !isRecord(value.workflowAudit) ||
    !hasExactKeys(value.workflowAudit, AUDIT_KEYS) ||
    !isSafeCount(value.workflowAudit.externalReferenceCount) ||
    !isSafeCount(value.workflowAudit.localReferenceCount) ||
    !isSafeCount(value.workflowAudit.unpinnedReferenceCount)
  ) {
    return false;
  }

  if (
    !isRecord(value.verification) ||
    !hasExactKeys(value.verification, VERIFICATION_KEYS) ||
    !isVerificationStatus(value.verification.ci) ||
    !isVerificationStatus(value.verification.codeql) ||
    !isVerificationStatus(value.verification.gitleaks) ||
    !isVerificationStatus(value.verification.release) ||
    !isVerificationStatus(value.verification.updater)
  ) {
    return false;
  }

  return true;
}

function result(reasons: readonly string[]): ActionsPolicyValidation {
  return Object.freeze({
    schemaVersion: ACTIONS_POLICY_SCHEMA_VERSION,
    policy: reasons.length === 0 ? "pass" : "hold",
    authorizesMutation: false,
    externalMutationPerformed: false,
    reasons: Object.freeze([...reasons]),
  });
}

/**
 * Validate a sanitized, read-only GitHub Actions policy snapshot.
 *
 * This helper deliberately does not call GitHub or mutate policy. It is an
 * offline gate for evidence collected by an authorized operator; malformed
 * input and unknown fields fail closed without reflecting their contents.
 */
export function validateActionsPolicy(
  input: unknown,
  now = Date.now(),
): ActionsPolicyValidation {
  if (!isEvidenceShape(input)) return result(["invalid-schema"]);

  const capturedAt = Date.parse(input.capturedAt);
  if (!Number.isFinite(now) || !Number.isFinite(capturedAt)) {
    return result(["invalid-schema"]);
  }

  const reasons: string[] = [];
  if (now - capturedAt > ACTIONS_POLICY_MAX_AGE_MS) {
    reasons.push("evidence-not-fresh");
  }
  if (capturedAt - now > ACTIONS_POLICY_MAX_FUTURE_SKEW_MS) {
    reasons.push("evidence-from-future");
  }
  if (input.scope.effectiveScope === "unknown") {
    reasons.push("effective-scope-unverified");
  }
  if (!input.policy.enabled) reasons.push("policy-disabled");
  if (!input.policy.shaPinningRequired) reasons.push("sha-pinning-disabled");
  if (
    input.workflowAudit.externalReferenceCount === 0 ||
    input.workflowAudit.localReferenceCount !== 0 ||
    input.workflowAudit.unpinnedReferenceCount !== 0
  ) {
    reasons.push("workflow-audit-failed");
  }
  if (
    input.verification.ci !== "success" ||
    input.verification.codeql !== "success" ||
    input.verification.gitleaks !== "success" ||
    input.verification.updater !== "success"
  ) {
    reasons.push("required-check-not-success");
  }
  if (input.verification.release !== "success") {
    reasons.push("release-not-verified");
  }

  return result(reasons);
}
