import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ONLINE_DIRECT_START_COMMAND,
  ROLLOUT_EVIDENCE_MAX_AGE_MS,
  ROLLOUT_EVIDENCE_MAX_FUTURE_SKEW_MS,
  validateOnlineRolloutPreflight,
} from "./rolloutPreflight";

const NOW = Date.parse("2026-08-28T04:00:00.000Z");
const SERVER_REVISION = "a".repeat(40);
const CLIENT_REVISION = "b".repeat(40);

function evidence(
  phase: "drained" | "pre-drain" | "pre-enable" = "pre-enable",
) {
  const accepting = phase !== "drained";
  return {
    schemaVersion: 1,
    phase,
    capturedAt: new Date(NOW).toISOString(),
    railwayObservedAt: new Date(NOW).toISOString(),
    target: {
      projectId: "project-fixture",
      serviceId: "service-fixture",
      environmentId: "environment-fixture",
      activeDeploymentId: "deployment-active-fixture",
      activeDeploymentStatus: "success",
      deploymentSet: {
        activeDeploymentId: "deployment-active-fixture",
        inProgressDeploymentIds: [] as string[],
        stagedChanges: false,
      },
    },
    rollback: {
      role: "prospective-after-approved-change",
      deploymentId: "deployment-active-fixture",
      sourceProvenance: {
        kind: "railway-git-commit",
        fullRevision: SERVER_REVISION.toUpperCase(),
      },
      retentionEligible: true,
      effectiveStartCommand: ONLINE_DIRECT_START_COMMAND as string,
      effectiveHealthcheckPath: "/readyz",
      effectiveDrainingSeconds: 30,
      shutdownGraceMs: 25_000,
      onlineOpsRequired: true,
      maintenanceNoticesEnabled: phase !== "pre-enable",
    },
    runtime: {
      replicaScope: "all-regions",
      regions: [
        { regionId: "region-fixture", replicaIds: ["replica-fixture"] },
      ],
      effectiveStartCommand: ONLINE_DIRECT_START_COMMAND as string,
      effectiveHealthcheckPath: "/readyz",
      effectiveDrainingSeconds: 30,
      shutdownGraceMs: 25_000,
    },
    source: {
      reviewedServerRevision: SERVER_REVISION,
      activeDeploymentRevision: SERVER_REVISION.toUpperCase(),
      opsStatusSourceRevision: SERVER_REVISION,
    },
    client: {
      reviewedRevision: CLIENT_REVISION,
      productionRevision: CLIENT_REVISION.toUpperCase(),
      deploymentId: "client-deployment-fixture",
      observedAt: new Date(NOW).toISOString(),
      compatibilityEvidenceUrls: [
        "https://github.com/AutoDevJapan/FourBrosMahjong/pull/729",
        "https://github.com/AutoDevJapan/FourBrosMahjong/pull/730",
      ],
    },
    operations: {
      onlineOpsRequired: true,
      maintenanceNoticesEnabled: phase !== "pre-enable",
      readyzStatus: accepting ? 200 : 503,
      drainState: accepting ? "accepting" : "drained",
      blockingDrainRooms: accepting ? 2 : 0,
      reconnectGraceRooms: accepting ? 1 : 0,
      opsStatusDeploymentId: "deployment-active-fixture",
      opsStatusReplicaId: "replica-fixture",
      observedAt: new Date(NOW).toISOString(),
      acceptingReadiness: {
        observedAt: new Date(
          phase === "drained" ? NOW - 1_000 : NOW,
        ).toISOString(),
        deploymentId: "deployment-active-fixture",
        sourceRevision: SERVER_REVISION,
        readyzStatus: 200,
      },
    },
  };
}

function cloneEvidence(
  phase: "drained" | "pre-drain" | "pre-enable" = "pre-enable",
) {
  return structuredClone(evidence(phase));
}

describe("online rollout preflight", () => {
  it("passes normalized pre-enable, pre-drain, and drained evidence without granting authority", () => {
    for (const phase of ["pre-enable", "pre-drain", "drained"] as const) {
      expect(validateOnlineRolloutPreflight(evidence(phase), NOW)).toEqual({
        schemaVersion: 1,
        repoPreflight: "pass",
        authorizesDeployment: false,
        externalMutationPerformed: false,
        reasons: [],
      });
    }
  });

  it("requires a stable Railway deployment set with no overlap or staged change", () => {
    const racing = cloneEvidence();
    racing.target.deploymentSet.inProgressDeploymentIds = [
      "deploy-in-progress",
    ];
    racing.target.deploymentSet.stagedChanges = true;
    expect(validateOnlineRolloutPreflight(racing, NOW).reasons).toEqual([
      "deployment-set-not-stable",
    ]);
  });

  it("strictly rejects unknown/raw secret fields without reflecting input", () => {
    const rawSecret = "secret-that-must-never-be-reflected";
    const unsafe = {
      ...evidence(),
      variables: { ONLINE_OPS_TOKEN: rawSecret },
    };
    const result = validateOnlineRolloutPreflight(unsafe, NOW);

    expect(result.repoPreflight).toBe("hold");
    expect(result.reasons).toEqual(["invalid-schema"]);
    expect(JSON.stringify(result)).not.toContain(rawSecret);
    expect(JSON.stringify(result)).not.toContain("ONLINE_OPS_TOKEN");
  });

  it("holds missing, ambiguous, and unconfirmed target/rollback identity", () => {
    const missing = cloneEvidence();
    missing.target.projectId = "";
    missing.target.activeDeploymentId = "unknown deployment";
    missing.rollback.deploymentId = "different-deployment";
    missing.rollback.retentionEligible = false;

    expect(validateOnlineRolloutPreflight(missing, NOW).reasons).toEqual([
      "target-identity-invalid",
      "rollback-not-available",
      "deployment-set-not-stable",
      "ops-deployment-mismatch",
      "readiness-status-mismatch",
    ]);
  });

  it("holds provider unknown placeholders instead of treating them as identities", () => {
    for (const placeholder of ["unknown", "UNKNOWN", "UnKnOwN"]) {
      const ambiguous = cloneEvidence();
      ambiguous.target.projectId = placeholder;

      const result = validateOnlineRolloutPreflight(ambiguous, NOW);
      expect(result.repoPreflight).toBe("hold");
      expect(result.reasons).toContain("target-identity-invalid");
    }
  });

  it("requires a fresh canonical snapshot and fresh client observation", () => {
    const stale = cloneEvidence();
    stale.capturedAt = new Date(
      NOW - ROLLOUT_EVIDENCE_MAX_AGE_MS - 1,
    ).toISOString();
    stale.client.observedAt = stale.capturedAt;
    expect(validateOnlineRolloutPreflight(stale, NOW).reasons).toEqual([
      "evidence-not-fresh",
      "client-evidence-not-fresh",
    ]);

    const future = cloneEvidence();
    future.capturedAt = new Date(
      NOW + ROLLOUT_EVIDENCE_MAX_FUTURE_SKEW_MS + 1,
    ).toISOString();
    expect(validateOnlineRolloutPreflight(future, NOW).reasons).toEqual([
      "evidence-from-future",
    ]);
  });

  it("requires fresh mutually bounded Railway and authenticated ops captures", () => {
    const skewed = cloneEvidence();
    skewed.railwayObservedAt = new Date(NOW - 60_000).toISOString();
    skewed.operations.acceptingReadiness.observedAt = new Date(
      NOW - 6 * 60_000,
    ).toISOString();
    expect(validateOnlineRolloutPreflight(skewed, NOW).reasons).toEqual([
      "evidence-not-fresh",
    ]);

    const boundedButSkewed = cloneEvidence();
    boundedButSkewed.railwayObservedAt = new Date(NOW - 60_000).toISOString();
    boundedButSkewed.operations.acceptingReadiness.observedAt = new Date(
      NOW - 60_000,
    ).toISOString();
    expect(
      validateOnlineRolloutPreflight(boundedButSkewed, NOW).reasons,
    ).toEqual(["evidence-capture-skew"]);
  });

  it("uses an explicit all-region total and an independent ops replica identity", () => {
    const invalid = cloneEvidence();
    invalid.runtime.replicaScope = "current-region";
    invalid.runtime.regions.push({
      regionId: "second-region",
      replicaIds: ["second-replica"],
    });
    invalid.operations.opsStatusReplicaId = "";

    expect(validateOnlineRolloutPreflight(invalid, NOW).reasons).toEqual([
      "replica-scope-not-all-regions",
      "replica-count-not-one",
      "ops-replica-identity-invalid",
    ]);

    const mismatch = cloneEvidence();
    mismatch.operations.opsStatusReplicaId = "different-replica";
    expect(validateOnlineRolloutPreflight(mismatch, NOW).reasons).toEqual([
      "ops-replica-mismatch",
    ]);
  });

  it("requires a retained rollback with full source and safe effective config", () => {
    const invalid = cloneEvidence();
    invalid.rollback.retentionEligible = false;
    invalid.rollback.effectiveStartCommand = "pnpm server:start";
    invalid.rollback.effectiveHealthcheckPath = "/healthz";
    invalid.rollback.effectiveDrainingSeconds = 0;
    invalid.rollback.onlineOpsRequired = false;

    expect(validateOnlineRolloutPreflight(invalid, NOW).reasons).toEqual([
      "rollback-not-available",
      "rollback-config-invalid",
    ]);
  });

  it("fails closed for topology, shutdown, and required-ops ambiguity", () => {
    const invalid = cloneEvidence();
    invalid.runtime.regions[0]!.replicaIds = [
      "replica-fixture",
      "replica-fixture",
    ];
    invalid.runtime.shutdownGraceMs = Number.NaN;
    invalid.operations.onlineOpsRequired = false;
    expect(validateOnlineRolloutPreflight(invalid, NOW).reasons).toEqual([
      "replica-topology-invalid",
      "replica-count-not-one",
      "shutdown-grace-invalid",
      "rollback-config-invalid",
      "ops-not-required",
    ]);
  });

  it("never treats an unsafe current baseline as an enable-ready prospective rollback", () => {
    const unsafeRollback = cloneEvidence("pre-enable");
    unsafeRollback.rollback.effectiveStartCommand = "pnpm server:start";
    unsafeRollback.rollback.effectiveHealthcheckPath = "/healthz";
    unsafeRollback.rollback.onlineOpsRequired = false;
    expect(validateOnlineRolloutPreflight(unsafeRollback, NOW).reasons).toEqual(
      ["rollback-config-invalid"],
    );

    const unsupportedPhase = {
      ...evidence(),
      phase: "baseline-seed",
    };
    expect(
      validateOnlineRolloutPreflight(unsupportedPhase, NOW).reasons,
    ).toEqual(["invalid-schema"]);
  });

  it("holds an unknown or non-successful active deployment", () => {
    const building = cloneEvidence();
    building.target.activeDeploymentStatus = "building";
    expect(validateOnlineRolloutPreflight(building, NOW).reasons).toEqual([
      "active-deployment-not-successful",
    ]);
  });

  it("requires direct Node, readyz, and Railway draining beyond the app budget", () => {
    const invalid = cloneEvidence();
    invalid.runtime.effectiveStartCommand = "pnpm server:start";
    invalid.runtime.effectiveHealthcheckPath = "/healthz";
    invalid.runtime.effectiveDrainingSeconds = 29;

    expect(validateOnlineRolloutPreflight(invalid, NOW).reasons).toEqual([
      "effective-command-not-direct-node",
      "healthcheck-not-readyz",
      "draining-duration-insufficient",
      "rollback-config-invalid",
    ]);
  });

  it("requires reviewed, deployment, ops, and client full revisions to agree", () => {
    const mismatch = cloneEvidence();
    mismatch.source.activeDeploymentRevision = "c".repeat(40);
    mismatch.source.opsStatusSourceRevision = "d".repeat(40);
    mismatch.client.productionRevision = "e".repeat(40);

    expect(validateOnlineRolloutPreflight(mismatch, NOW).reasons).toEqual([
      "rollback-config-invalid",
      "active-deployment-source-mismatch",
      "ops-source-mismatch",
      "client-source-mismatch",
    ]);

    const abbreviated = cloneEvidence();
    abbreviated.source.reviewedServerRevision = "a".repeat(12);
    expect(validateOnlineRolloutPreflight(abbreviated, NOW).reasons).toContain(
      "source-revision-invalid",
    );
  });

  it("requires the exact reviewed client compatibility anchors", () => {
    const arbitrary = cloneEvidence();
    arbitrary.client.compatibilityEvidenceUrls = [
      "https://github.com/AutoDevJapan/FourBrosMahjong/pull/1",
      "https://github.com/AutoDevJapan/FourBrosMahjong/pull/2",
    ];
    expect(validateOnlineRolloutPreflight(arbitrary, NOW).reasons).toEqual([
      "client-evidence-invalid",
    ]);
  });

  it("rejects GitHub evidence URLs with a non-canonical port", () => {
    const nonCanonical = cloneEvidence();
    nonCanonical.client.compatibilityEvidenceUrls[0] =
      "https://github.com:444/AutoDevJapan/FourBrosMahjong/pull/729";

    expect(validateOnlineRolloutPreflight(nonCanonical, NOW).reasons).toEqual([
      "client-evidence-invalid",
    ]);
  });

  it("keeps the direct command aligned with Docker and its runtime verifier", () => {
    expect(readFileSync("Dockerfile", "utf8")).toContain(
      'CMD ["node", "--import", "tsx", "server/start.ts"]',
    );
    expect(
      readFileSync("scripts/verify-online-container-signal.mjs", "utf8"),
    ).toContain(`const EXPECTED_CMDLINE = "${ONLINE_DIRECT_START_COMMAND}";`);
    const railway = JSON.parse(readFileSync("railway.json", "utf8")) as {
      deploy?: { startCommand?: unknown };
    };
    expect(railway.deploy?.startCommand).toBe(ONLINE_DIRECT_START_COMMAND);
    const runtimePackage = JSON.parse(
      readFileSync("container/online/package.json", "utf8"),
    ) as { scripts?: unknown };
    expect(runtimePackage.scripts).toBeUndefined();
  });

  it("keeps the runbook secret-safe and makes release an abort-only branch", () => {
    const runbook = readFileSync(
      "documents/guides/railway-online-deploy-runbook.md",
      "utf8",
    );
    expect(runbook).toContain("pnpm validate:server:ops-token");
    expect(runbook).toContain('--header "@$OPS_HEADER_FILE"');
    expect(runbook).not.toContain("OPS_CURL_CONFIG");
    const successPath = runbook.indexOf("成功pathではDELETEを実行しない");
    const abortPath = runbook.indexOf("abort path（失敗・取消時だけ）");
    const release = runbook.indexOf(
      '--request DELETE "$OPS_BASE_URL/ops/drain"',
    );
    const deployment = runbook.indexOf(
      "## 3. 承認済みphaseごとに一度だけ deploy",
    );
    expect(successPath).toBeGreaterThan(0);
    expect(abortPath).toBeGreaterThan(successPath);
    expect(release).toBeGreaterThan(abortPath);
    expect(deployment).toBeGreaterThan(release);
    expect(runbook).toContain("POSTは再実行しない");
  });

  it("matches authenticated ops deployment identity to the active deployment", () => {
    const mismatch = cloneEvidence();
    mismatch.operations.opsStatusDeploymentId = "different-deployment";
    expect(validateOnlineRolloutPreflight(mismatch, NOW).reasons).toEqual([
      "ops-deployment-mismatch",
    ]);
  });

  it("keeps pre-enable default-off and requires zero blockers only after drain", () => {
    const enableMismatch = cloneEvidence("pre-enable");
    enableMismatch.operations.maintenanceNoticesEnabled = true;
    enableMismatch.operations.readyzStatus = 503;
    enableMismatch.operations.drainState = "drained";
    expect(validateOnlineRolloutPreflight(enableMismatch, NOW).reasons).toEqual(
      ["maintenance-phase-mismatch", "readiness-status-mismatch"],
    );

    const deployNotReady = cloneEvidence("drained");
    deployNotReady.operations.blockingDrainRooms = 1;
    deployNotReady.operations.reconnectGraceRooms = 1;
    expect(validateOnlineRolloutPreflight(deployNotReady, NOW).reasons).toEqual(
      ["drain-not-ready"],
    );

    const outOfOrder = cloneEvidence("drained");
    outOfOrder.operations.acceptingReadiness.observedAt =
      outOfOrder.operations.observedAt;
    expect(validateOnlineRolloutPreflight(outOfOrder, NOW).reasons).toEqual([
      "evidence-capture-skew",
    ]);
  });

  it("rejects an invalid injected clock before reading evidence", () => {
    for (const invalidNow of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(() =>
        validateOnlineRolloutPreflight(evidence(), invalidNow),
      ).toThrow(RangeError);
    }
  });

  it("exposes a fixed non-reflective stdin CLI contract", () => {
    const cliNow = new Date().toISOString();
    const validInput = {
      ...evidence(),
      capturedAt: cliNow,
      railwayObservedAt: cliNow,
      client: {
        ...evidence().client,
        observedAt: cliNow,
      },
      operations: {
        ...evidence().operations,
        observedAt: cliNow,
        acceptingReadiness: {
          ...evidence().operations.acceptingReadiness,
          observedAt: cliNow,
        },
      },
    };
    const passed = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/verify-online-rollout-preflight.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        input: JSON.stringify(validInput),
      },
    );
    expect(passed.status, `${passed.stdout}\n${passed.stderr}`).toBe(0);
    expect(JSON.parse(passed.stdout)).toMatchObject({
      repoPreflight: "pass",
      authorizesDeployment: false,
      externalMutationPerformed: false,
    });

    const duplicateKeys = JSON.stringify(validInput).replace(
      '{"schemaVersion":1,',
      '{"schemaVersion":1,"schemaVersion":1,',
    );
    const duplicateResult = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/verify-online-rollout-preflight.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        input: duplicateKeys,
      },
    );
    expect(duplicateResult.status).toBe(1);
    expect(duplicateResult.stderr).toBe("");
    expect(JSON.parse(duplicateResult.stdout)).toMatchObject({
      repoPreflight: "hold",
      reasons: ["invalid-schema"],
    });

    const secret = "cli-secret-must-not-be-reflected";
    const held = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/verify-online-rollout-preflight.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        input: JSON.stringify({ authorization: secret }),
      },
    );
    expect(held.status).toBe(1);
    expect(JSON.parse(held.stdout)).toMatchObject({
      repoPreflight: "hold",
      reasons: ["invalid-schema"],
      authorizesDeployment: false,
      externalMutationPerformed: false,
    });
    expect(held.stdout).not.toContain(secret);

    const oversizedSecret = "oversized-secret".repeat(5_000);
    const oversized = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/verify-online-rollout-preflight.ts"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        input: oversizedSecret,
      },
    );
    expect(oversized.status).toBe(1);
    expect(JSON.parse(oversized.stdout)).toMatchObject({
      repoPreflight: "hold",
      reasons: ["invalid-schema"],
    });
    expect(oversized.stdout).not.toContain("oversized-secret");
  });
});
