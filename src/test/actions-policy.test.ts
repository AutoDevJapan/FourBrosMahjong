import { describe, expect, it } from "vitest";
import {
  ACTIONS_POLICY_MAX_AGE_MS,
  ACTIONS_POLICY_MAX_FUTURE_SKEW_MS,
  validateActionsPolicy,
} from "../../scripts/actionsPolicy";

const NOW = Date.parse("2026-09-06T08:00:00.000Z");

function evidence() {
  return {
    capturedAt: new Date(NOW).toISOString(),
    policy: {
      allowedActions: "all",
      enabled: true,
      shaPinningRequired: true,
    },
    scope: {
      effectiveScope: "repository",
      organization: "AutoDevJapan",
      repository: "FourBrosMahjong",
    },
    schemaVersion: 1,
    verification: {
      ci: "success",
      codeql: "success",
      gitleaks: "success",
      release: "success",
      updater: "success",
    },
    workflowAudit: {
      externalReferenceCount: 20,
      localReferenceCount: 0,
      unpinnedReferenceCount: 0,
    },
  };
}

describe("GitHub Actions policy evidence (#663)", () => {
  it("passes a fresh, exact, fully verified policy snapshot", () => {
    expect(validateActionsPolicy(evidence(), NOW)).toEqual({
      schemaVersion: 1,
      policy: "pass",
      authorizesMutation: false,
      externalMutationPerformed: false,
      reasons: [],
    });
  });

  it("requires an authorized effective scope instead of treating repository scope as global", () => {
    const candidate = evidence();
    candidate.scope.effectiveScope = "unknown";

    expect(validateActionsPolicy(candidate, NOW).reasons).toContain(
      "effective-scope-unverified",
    );
  });

  it.each([
    ["stale", -ACTIONS_POLICY_MAX_AGE_MS - 1, "evidence-not-fresh"],
    ["future", ACTIONS_POLICY_MAX_FUTURE_SKEW_MS + 1, "evidence-from-future"],
  ] as const)("rejects %s evidence timestamps", (_label, offset, reason) => {
    const candidate = evidence();
    candidate.capturedAt = new Date(NOW + offset).toISOString();

    expect(validateActionsPolicy(candidate, NOW).reasons).toContain(reason);
  });

  it("fails closed when a workflow is unpinned or a required check did not succeed", () => {
    const candidate = evidence();
    candidate.workflowAudit.unpinnedReferenceCount = 1;
    candidate.verification.gitleaks = "not-run";

    expect(validateActionsPolicy(candidate, NOW).reasons).toEqual(
      expect.arrayContaining([
        "workflow-audit-failed",
        "required-check-not-success",
      ]),
    );
  });

  it("does not treat a policy snapshot without a release run as verified", () => {
    const candidate = evidence();
    candidate.verification.release = "not-run";

    expect(validateActionsPolicy(candidate, NOW).reasons).toContain(
      "release-not-verified",
    );
  });

  it("rejects unknown fields without reflecting secrets", () => {
    const secret = "Authorization=Bearer do-not-reflect";
    const candidate = evidence() as Record<string, unknown>;
    candidate.unrelatedSecret = secret;

    const result = validateActionsPolicy(candidate, NOW);
    expect(result).toEqual({
      schemaVersion: 1,
      policy: "hold",
      authorizesMutation: false,
      externalMutationPerformed: false,
      reasons: ["invalid-schema"],
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
