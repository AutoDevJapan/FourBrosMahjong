import { readFileSync } from "node:fs";
import { createRailwayContext, project, service } from "railway/iac";
import { describe, expect, it } from "vitest";
import authoring, { partial } from "../../.railway/railway";
import {
  generatedIacSourceIsSecretSafe,
  validateRailwayIacMigrationEvidence,
} from "../../scripts/railway-iac-migration-contract";
import {
  FOURBROS_IAC_ADDRESS as ADDRESS,
  FOURBROS_IAC_PARTIAL,
  FOURBROS_IAC_SDK_SCHEMA_SHA256,
  iacSha256,
  inspectNamedPartialSource,
  singleFileIacTree,
  FOURBROS_IAC_TARGET as TARGET,
} from "../../scripts/railway-iac-named-partial";
import { localFilesystemEvidence } from "../../scripts/verify-railway-iac-migration";

const NOW = Date.parse("2026-11-09T03:00:00.000Z");
const SOURCE = readFileSync(".railway/railway.ts", "utf8");
const ARCHIVED_READY_CONFIG = readFileSync(
  "documents/fixtures/railway-readyz-before-iac.json",
  "utf8",
);
const FILESYSTEM = localFilesystemEvidence();
const CONFIG_ETAG = "a".repeat(64);
const OTHER = "service.untouched-fixture";

function resource(address: string) {
  return {
    address,
    type: "service",
    kind: "empty",
    name: address.slice("service.".length),
    engine: null,
    variables: null as Record<string, unknown> | null,
    source: null,
    build: { buildEnvironment: "V3", builder: "RAILPACK" } as Record<
      string,
      unknown
    >,
    deploy: { multiRegionConfig: { "us-west2": { numReplicas: 1 } } } as Record<
      string,
      unknown
    >,
    networking: null,
    volumeAttachments: null,
    config: null,
    groupId: null,
    tracing: null,
    cdn: null,
  };
}

function validEvidence() {
  const target: Record<keyof typeof TARGET, string> = { ...TARGET };
  const definition = inspectNamedPartialSource(SOURCE);
  if (!definition) throw new Error("expected target partial source");
  const before = resource(ADDRESS);
  before.variables = { ALLOWED_ORIGINS: { type: "preserve" } };
  const after = {
    ...resource(ADDRESS),
    build: definition.build,
    deploy: definition.deploy,
  };
  const changeSet = {
    changes: ["build", "deploy"].map((field) => ({
      address: ADDRESS,
      after: after[field as "build" | "deploy"],
      before: before[field as "build" | "deploy"],
      deployEffect: "deploy",
      details: [
        `${field === "build" ? "build.builder" : "deploy.startCommand"} changes`,
      ],
      field,
      kind: "resource.update",
      path: `resources.${ADDRESS}.${field}`,
      severity: "safe",
      summary: `Update target ${field}`,
    })),
    declared: [ADDRESS],
    diagnostics: [] as unknown[],
    partial: FOURBROS_IAC_PARTIAL,
    telemetry: { language: "typescript" },
    version: 1,
  };
  const pin = {
    kind: "railway.config.plan",
    version: 1,
    cliVersion: "5.71.0",
    sourceTree: singleFileIacTree(SOURCE),
    environmentId: String(TARGET.environmentId),
    configEtag: CONFIG_ETAG,
    changeSetHash: `sha256:${iacSha256(JSON.stringify(changeSet))}`,
    changeSet,
    diff: "redacted fixture diff",
    destructive: false,
    claim: true,
  };
  const output = {
    ok: true,
    command: "plan",
    file: "/fixture/.railway/railway.ts",
    currentEnvironment: {
      projectId: TARGET.projectId,
      projectName: TARGET.projectName,
      environmentId: TARGET.environmentId,
      environmentName: TARGET.environmentName,
      configEtag: CONFIG_ETAG,
      pr: null,
    },
    changeSet: {
      changes: changeSet.changes.map(
        ({ summary, severity, kind, details }) => ({
          summary,
          severity,
          kind,
          details,
        }),
      ),
    },
    diff: "redacted fixture diff",
    diagnostics: [],
    currentGraph: {
      project: { name: TARGET.projectName },
      resources: [before, resource(OTHER)],
    },
    desiredGraph: { project: { name: TARGET.projectName }, resources: [after] },
    stagedPatch: null,
    applyResult: null,
    deploymentId: null,
    stagedPatchId: null,
    variablePolicy: {
      managed: false,
      ignore: [],
      default: false,
      ignoredCount: 0,
      byPattern: {},
    },
  };
  const timestamp = new Date(NOW).toISOString();
  const evidence = {
    schemaVersion: 2,
    phase: "runtime-update",
    capturedAt: timestamp,
    cliEvidence: {
      cliVersion: "5.71.0",
      capturedFromHelp: true,
      nativeEngine: true,
      planJsonSupported: true,
      planOutSupported: true,
      detailedExitCodeSupported: true,
      sdkPackageVersion: "3.16.0",
      sdkSchemaSha256: FOURBROS_IAC_SDK_SCHEMA_SHA256,
    },
    target,
    source: {
      path: ".railway/railway.ts",
      sha256: iacSha256(SOURCE),
      treeSha1: singleFileIacTree(SOURCE),
      generatedBy:
        "railway config migrate --service four-bros-mahjong-online --variables unmanaged --apply",
      generatedSource: SOURCE,
      generatedSourceSha256: iacSha256(SOURCE),
      variablesMode: "unmanaged",
      generationLocalOnly: true,
      decryptVariablesUsed: false,
      omitPreservedVariablesUsed: false,
      manualSecretReviewCompleted: true,
    },
    inventory: {
      observedAt: timestamp,
      projectId: TARGET.projectId,
      environmentId: TARGET.environmentId,
      serviceId: TARGET.serviceId,
      serviceName: TARGET.serviceName,
      targetServiceAddress: ADDRESS,
      resourceAddresses: [ADDRESS, OTHER],
      targetMembershipEvidenceSha256: "b".repeat(64),
      configFileSetting: "" as string | null,
    },
    ownership: {
      ok: true,
      environmentId: TARGET.environmentId,
      environmentName: "production",
      configEtag: CONFIG_ETAG,
      iacPartials: {} as Record<string, string>,
      wholeProjectAvailable: true,
    },
    ownershipObservedAt: timestamp,
    plan: {
      capturedAt: timestamp,
      sourceSha256: iacSha256(SOURCE),
      pinnedText: "",
      pinnedSha256: "",
      outputText: "",
      outputSha256: "",
      storedOutsideRepository: true,
      exitCode: 2,
      detailedExitCodeUsed: true,
      showValuesUsed: false,
      decryptVariablesUsed: false,
      nativeEngine: true,
    },
  };
  return { evidence, pin, output };
}

function finalized(fixture: ReturnType<typeof validEvidence>) {
  const { evidence, pin, output } = fixture;
  pin.changeSetHash = `sha256:${iacSha256(JSON.stringify(pin.changeSet))}`;
  evidence.plan.pinnedText = JSON.stringify(pin);
  evidence.plan.pinnedSha256 = iacSha256(evidence.plan.pinnedText);
  evidence.plan.outputText = JSON.stringify(output);
  evidence.plan.outputSha256 = iacSha256(evidence.plan.outputText);
  return evidence;
}
function checked(
  fixture = validEvidence(),
  filesystem = FILESYSTEM,
  now = NOW,
) {
  return validateRailwayIacMigrationEvidence(
    finalized(fixture),
    filesystem,
    now,
  );
}

describe("#742 named partial native plan contract", () => {
  it("rejects a root Config as Code file even with an empty service setting", () => {
    expect(
      checked(validEvidence(), {
        ...FILESYSTEM,
        legacyJsonFilePresent: true,
      }).reasons,
    ).toContain("alternate-legacy-config-present");
  });

  it("accepts the named partial without root Config as Code files", () => {
    expect(
      checked(validEvidence(), {
        ...FILESYSTEM,
        legacyJsonFilePresent: false,
        currentRepositoryFilePresent: false,
        currentRepositoryFileContent: null,
        currentRepositoryFileSha256: null,
      }).migrationEvidence,
    ).toBe("pass");
    expect(FILESYSTEM).toMatchObject({
      legacyJsonFilePresent: false,
      legacyTomlFilePresent: false,
      currentRepositoryFilePresent: false,
      currentRepositoryFileContent: null,
      currentRepositoryFileSha256: null,
    });
  });

  it.each([undefined, true])(
    "rejects unverified or unreadable root JSON absence: %s",
    (presence) => {
      expect(
        checked(validEvidence(), {
          ...FILESYSTEM,
          legacyJsonFilePresent: presence,
        }).reasons,
      ).toContain("alternate-legacy-config-present");
    },
  );

  it("rejects contradictory readable content with a claimed absent root JSON", () => {
    expect(
      checked(validEvidence(), {
        ...FILESYSTEM,
        legacyJsonFilePresent: false,
        currentRepositoryFilePresent: true,
        currentRepositoryFileContent: ARCHIVED_READY_CONFIG,
        currentRepositoryFileSha256: iacSha256(ARCHIVED_READY_CONFIG),
      }).reasons,
    ).toContain("alternate-legacy-config-present");
  });

  it("accepts only an explicit empty Config File setting after ownership cutover", () => {
    const disabled = validEvidence();
    disabled.evidence.inventory.configFileSetting = "";
    expect(checked(disabled).migrationEvidence).toBe("pass");
    const unspecified = validEvidence();
    unspecified.evidence.inventory.configFileSetting = null;
    expect(checked(unspecified).reasons).toContain(
      "ownership-cutover-unverified",
    );
  });
  it("accepts only the existing service while preserving omitted unowned resources and variables", () => {
    expect(checked()).toEqual({
      schemaVersion: 2,
      migrationEvidence: "pass",
      authorizesMigration: false,
      authorizesApply: false,
      authorizesDeployment: false,
      externalMutationPerformed: false,
      reasons: [],
    });
  });
  it("accepts another partial's omitted resource without claiming or deleting it", () => {
    const fixture = validEvidence();
    fixture.evidence.ownership.iacPartials[OTHER] = "another-repository";
    fixture.evidence.ownership.wholeProjectAvailable = false;
    expect(checked(fixture).reasons).toEqual([]);
  });
  it("accepts the stable current partial owning only the target", () => {
    const fixture = validEvidence();
    fixture.evidence.ownership.iacPartials[ADDRESS] = FOURBROS_IAC_PARTIAL;
    fixture.evidence.ownership.wholeProjectAvailable = false;
    fixture.pin.claim = false;
    expect(checked(fixture).reasons).toEqual([]);
  });
  it.each(["projectId", "environmentId", "serviceId"] as const)(
    "rejects another target %s",
    (field) => {
      const fixture = validEvidence();
      fixture.evidence.target[field] = "different";
      expect(checked(fixture).reasons).toContain("target-identity-invalid");
    },
  );
  it.each([
    [
      "competing-owner",
      (f: ReturnType<typeof validEvidence>) => {
        f.evidence.ownership.iacPartials[ADDRESS] = "another-repo";
        f.evidence.ownership.wholeProjectAvailable = false;
      },
    ],
    [
      "unrelated-owned-resource",
      (f: ReturnType<typeof validEvidence>) => {
        f.evidence.ownership.iacPartials[OTHER] = FOURBROS_IAC_PARTIAL;
        f.evidence.ownership.wholeProjectAvailable = false;
      },
    ],
    [
      "whole-project-owner",
      (f: ReturnType<typeof validEvidence>) => {
        f.evidence.ownership.iacPartials[ADDRESS] = "*";
        f.evidence.ownership.wholeProjectAvailable = false;
      },
    ],
  ] as const)("holds %s", (_label, mutate) => {
    const f = validEvidence();
    mutate(f);
    expect(checked(f).reasons).toContain("partial-ownership-invalid");
  });
  it.each(["5.41.2", "5.42.1-rc.1", "not-a-version"])(
    "rejects unsupported CLI %s",
    (version) => {
      const f = validEvidence();
      f.evidence.cliEvidence.cliVersion = version;
      expect(checked(f).reasons).toContain("cli-capability-unverified");
    },
  );
  it("binds SDK version and schema to installed exact files", () => {
    const f = validEvidence();
    f.evidence.cliEvidence.sdkPackageVersion = "3.11.0";
    expect(checked(f).reasons).toContain("sdk-schema-unverified");
    expect(FILESYSTEM.sdkPackageVersion).toBe("3.16.0");
    expect(FILESYSTEM.sdkSchemaSha256).toBe(FOURBROS_IAC_SDK_SCHEMA_SHA256);
  });
  it.each(["sourceTree", "configEtag", "environmentId"] as const)(
    "rejects mismatched pinned %s",
    (field) => {
      const f = validEvidence();
      f.pin[field] = "wrong";
      expect(checked(f).reasons).toContain("pinned-plan-unverified");
    },
  );
  it.each(["partial", "declared"] as const)(
    "rejects changed declaration %s",
    (field) => {
      const f = validEvidence();
      if (field === "partial") f.pin.changeSet.partial = "other";
      else f.pin.changeSet.declared.push(OTHER);
      expect(checked(f).reasons).toContain("pinned-plan-unverified");
    },
  );
  it.each(["resource.create", "resource.delete", "variable.update"])(
    "rejects %s even if marked safe",
    (kind) => {
      const f = validEvidence();
      f.pin.changeSet.changes[0]!.kind = kind;
      expect(checked(f).reasons).toContain("runtime-changes-outside-allowlist");
    },
  );
  it("rejects an update belonging to an omitted resource", () => {
    const f = validEvidence();
    f.pin.changeSet.changes[0]!.address = OTHER;
    expect(checked(f).reasons).toContain("runtime-changes-outside-allowlist");
  });
  it("rejects additional desired resources and duplicate inventories", () => {
    const f = validEvidence();
    f.output.desiredGraph.resources.push(resource(OTHER));
    expect(checked(f).reasons).toContain("native-plan-invalid");
    const duplicate = validEvidence();
    duplicate.evidence.inventory.resourceAddresses.push(ADDRESS);
    expect(checked(duplicate).reasons).toContain("resource-inventory-mismatch");
  });
  it.each(["showValuesUsed", "decryptVariablesUsed"] as const)(
    "holds unsafe CLI option %s",
    (field) => {
      const f = validEvidence();
      f.evidence.plan[field] = true;
      expect(checked(f).reasons).toContain("pinned-plan-unverified");
    },
  );
  it("rejects current variables decoded to literal values", () => {
    const f = validEvidence();
    f.output.currentGraph.resources[0]!.variables = {
      ALLOWED_ORIGINS: { type: "literal", value: "private-value" },
    };
    const result = checked(f);
    expect(result.reasons).toContain("native-plan-invalid");
    expect(JSON.stringify(result)).not.toContain("private-value");
  });
  it("keeps ownership parity separate from updates that deploy runtime config", () => {
    const f = validEvidence();
    f.evidence.phase = "ownership-parity";
    expect(checked(f).reasons).toContain("parity-plan-not-clean");
  });
  it("accepts a no-change parity source without making the active image current", () => {
    const f = validEvidence();
    f.evidence.phase = "ownership-parity";
    f.pin.changeSet.changes = [];
    f.output.changeSet.changes = [];
    f.output.currentGraph.resources[0] = structuredClone(
      f.output.desiredGraph.resources[0]!,
    );
    f.evidence.plan.exitCode = 0;
    expect(checked(f).migrationEvidence).toBe("pass");
  });
  it("rejects a pending-change exit0 and missing changes in native output", () => {
    const f = validEvidence();
    f.evidence.plan.exitCode = 0;
    expect(checked(f).reasons).toContain("runtime-changes-outside-allowlist");
    const missing = validEvidence();
    missing.output.changeSet.changes = [];
    expect(checked(missing).reasons).toContain("native-plan-invalid");
  });
  it("rejects stale/future evidence, unknown keys and invalid clocks", () => {
    expect(
      checked(validEvidence(), FILESYSTEM, NOW + 301_000).reasons,
    ).toContain("evidence-stale");
    expect(
      checked(validEvidence(), FILESYSTEM, NOW - 31_000).reasons,
    ).toContain("evidence-stale");
    expect(checked(validEvidence(), FILESYSTEM, Number.NaN).reasons).toContain(
      "clock-invalid",
    );
    const f = validEvidence();
    Object.assign(f.evidence, { token: "do-not-reflect" });
    expect(checked(f).reasons).toContain("invalid-schema");
  });
  it.each(["inventory", "ownership", "plan"])(
    "rejects out-of-order %s snapshots",
    (stage) => {
      const f = validEvidence();
      const later = new Date(NOW + 1000).toISOString();
      if (stage === "inventory") f.evidence.inventory.observedAt = later;
      else if (stage === "ownership") f.evidence.ownershipObservedAt = later;
      else f.evidence.plan.capturedAt = later;
      expect(checked(f).reasons).toContain("evidence-stale");
    },
  );
  it.each([
    "/fixture/.railway/../railway.ts",
    "/fixture/other.ts",
    "/fixture/.railway/railway.ts\0",
  ])("rejects native plan for another authoring path %s", (path) => {
    const f = validEvidence();
    f.output.file = path;
    expect(checked(f).reasons).toContain("native-plan-invalid");
  });
  it("rejects unexpected settings concealed in native change details", () => {
    const f = validEvidence();
    f.pin.changeSet.changes[0]!.details.push("source.image (old → unrelated)");
    expect(checked(f).reasons).toContain("runtime-changes-outside-allowlist");
  });
  it("binds the redacted diff to the pinned plan", () => {
    const f = validEvidence();
    f.output.diff = "another plan";
    expect(checked(f).reasons).toContain("native-plan-invalid");
  });
  it("rejects root JSON regardless of its valid, duplicate-key or stale contents", () => {
    for (const source of [
      ARCHIVED_READY_CONFIG,
      ARCHIVED_READY_CONFIG.replace('"deploy": {', '"deploy": {},"deploy": {'),
      ARCHIVED_READY_CONFIG.replace("/readyz", "/healthz"),
    ]) {
      expect(
        checked(validEvidence(), {
          ...FILESYSTEM,
          legacyJsonFilePresent: true,
          currentRepositoryFilePresent: true,
          currentRepositoryFileContent: source,
          currentRepositoryFileSha256: iacSha256(source),
        }).reasons,
      ).toContain("alternate-legacy-config-present");
    }
  });
  it("rejects duplicate native JSON names before parsing silently overwrites them", () => {
    const f = validEvidence();
    const evidence = finalized(f);
    evidence.plan.pinnedText = evidence.plan.pinnedText.replace(
      '"version":1',
      '"version":1,"version":1',
    );
    evidence.plan.pinnedSha256 = iacSha256(evidence.plan.pinnedText);
    expect(
      validateRailwayIacMigrationEvidence(evidence, FILESYSTEM, NOW).reasons,
    ).toContain("invalid-schema");
  });
  it("retains immutable fixture, UTF8 reader and exact source hash requirements", () => {
    expect(
      checked(validEvidence(), {
        ...FILESYSTEM,
        legacyFixtureSha256: "c".repeat(64),
      }).reasons,
    ).toContain("legacy-config-missing");
    expect(
      checked(validEvidence(), {
        ...FILESYSTEM,
        generatedIacSource: `${SOURCE}\n`,
      }).reasons,
    ).toContain("generated-iac-invalid");
    const f = validEvidence();
    f.evidence.inventory.configFileSetting = "railway.json";
    expect(checked(f).reasons).toContain("ownership-cutover-unverified");
  });
  it("fails closed on malformed plan records without reflecting their values", () => {
    for (const key of [
      "ownership",
      "inventory",
      "source",
      "cliEvidence",
    ] as const) {
      const f = validEvidence();
      Object.assign(f.evidence, { [key]: null });
      const result = checked(f);
      expect(result.migrationEvidence).toBe("hold");
      expect(result.reasons.length).toBeGreaterThan(0);
    }
  });
});

describe("named-partial source and native SDK", () => {
  it("evaluates the generated target with the installed SDK3.16.0 and preserved variable policy", async () => {
    expect(partial).toBe(FOURBROS_IAC_PARTIAL);
    const graph = await authoring(
      createRailwayContext({
        projectId: TARGET.projectId,
        projectName: TARGET.projectName,
        environmentId: TARGET.environmentId,
        environment: "production",
      }),
      project,
    );
    const expectedDefinition = {
      variables: { managed: false },
      resources: [
        service(TARGET.serviceName, {
          build: {
            buildEnvironment: "V3",
            builder: "DOCKERFILE",
            dockerfilePath: "Dockerfile",
          },
          start: "node --import tsx server/start.ts",
          healthcheck: "/readyz",
          healthcheckTimeout: 60,
          deploy: {
            drainingSeconds: 30,
            overlapSeconds: 0,
            restartPolicyType: "ON_FAILURE",
            restartPolicyMaxRetries: 10,
          },
          replicas: { "us-west2": 1 },
        }),
      ],
    };
    expect(graph).toEqual(project(TARGET.projectName, expectedDefinition));
    expect(graph.resources).toHaveLength(1);
    expect(generatedIacSourceIsSecretSafe(SOURCE)).toBe(true);
  });
  it.each([
    [
      "different partial",
      () =>
        SOURCE.replace(
          'export const partial = "four-bros-mahjong-online"',
          'export const partial = "renamed"',
        ),
    ],
    [
      "variable management",
      () => SOURCE.replace("managed: false", "managed: true"),
    ],
    [
      "raw variable",
      () =>
        SOURCE.replace("managed: false", 'ONLINE_OPS_TOKEN: "secret-value"'),
    ],
    [
      "source swap",
      () =>
        SOURCE.replace('"four-bros-mahjong-online", {', '"other-service", {'),
    ],
    [
      "replica increase",
      () => SOURCE.replace('"us-west2": 1', '"us-west2": 2'),
    ],
    [
      "negative draining",
      () => SOURCE.replace("drainingSeconds: 30", "drainingSeconds: -1"),
    ],
    [
      "invalid restart policy",
      () =>
        SOURCE.replace(
          'restartPolicyType: "ON_FAILURE"',
          'restartPolicyType: "arbitrary"',
        ),
    ],
    [
      "unexpected domain",
      () =>
        SOURCE.replace(
          'healthcheck: "/readyz",',
          'healthcheck: "/readyz", domains: ["unrelated.example"],',
        ),
    ],
    [
      "additional resource",
      () =>
        SOURCE.replace(
          "resources: [fourBrosMahjongOnline]",
          'resources: [fourBrosMahjongOnline, service("another")]',
        ),
    ],
    [
      "duplicate property",
      () => SOURCE.replace("managed: false", "managed: false, managed: false"),
    ],
    ["side effects", () => `${SOURCE}\nfetch("https://unrelated.example");`],
    [
      "shadowed factory",
      () => SOURCE.replace("const fourBrosMahjongOnline", "const service"),
    ],
    [
      "reused import binding",
      () => SOURCE.replace("const definition =", "const project ="),
    ],
    [
      "dynamic project policy",
      () =>
        SOURCE.replace(
          'project("godd-genesis", definition)',
          'project("godd-genesis", process.env)',
        ),
    ],
    [
      "unbound policy",
      () =>
        SOURCE.replace(
          'project("godd-genesis", definition)',
          'project("godd-genesis", untrusted)',
        ),
    ],
  ] as const)("rejects %s", (_label, mutate) => {
    expect(inspectNamedPartialSource(mutate())).toBeNull();
  });
  it("never extends the generic secret scan to arbitrary project aliases", () => {
    const unrelated = SOURCE.replace(
      'export const partial = "four-bros-mahjong-online"',
      'export const partial = "other"',
    );
    expect(unrelated).not.toBe(SOURCE);
    expect(generatedIacSourceIsSecretSafe(unrelated)).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        SOURCE.replace("managed: false", "managed: true"),
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        SOURCE.replace("managed: false", 'ALLOWED_ORIGINS: "SECRET_SENTINEL"'),
      ),
    ).toBe(false);
  });
});
