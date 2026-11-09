import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  STAGED_RAILWAY_IAC_PATH,
  stageRailwayIacSource,
} from "../../scripts/stage-railway-iac";

const SAFE_SOURCE = `
import { defineRailway, project, service } from "railway/iac";
export const partial = "four-bros-mahjong-online";
export default defineRailway(() => {
  const web = service("four-bros-mahjong-online", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    start: "node --import tsx server/start.ts", healthcheck: "/readyz", healthcheckTimeout: 60,
    replicas: { "us-west2": 1 },
  });
  return project("godd-genesis", { variables: { managed: false }, resources: [web] });
});
`;

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createRepository(): string {
  const repository = mkdtempSync(join(tmpdir(), "railway-iac-stage-repo-"));
  temporaryDirectories.push(repository);
  return repository;
}

function createSource(
  contents = SAFE_SOURCE,
  fileName = "railway.ts",
): {
  readonly directory: string;
  readonly path: string;
} {
  const directory = mkdtempSync(join(tmpdir(), "railway-iac-stage-source-"));
  temporaryDirectories.push(directory);
  const path = join(directory, fileName);
  writeFileSync(path, contents);
  return { directory, path };
}

describe("stageRailwayIacSource", () => {
  it("validates an external railway.ts without creating repository state", () => {
    const repository = createRepository();
    const source = createSource();

    const result = stageRailwayIacSource({
      sourcePath: source.path,
      repositoryRoot: repository,
      write: false,
    });

    expect(result).toEqual({
      ok: true,
      mode: "validated",
      bytes: Buffer.byteLength(SAFE_SOURCE),
      sha256: createHash("sha256").update(SAFE_SOURCE).digest("hex"),
    });
    expect(() =>
      lstatSync(join(repository, STAGED_RAILWAY_IAC_PATH)),
    ).toThrow();
  });

  it("stages the exact validated bytes and reports their hash", () => {
    const repository = createRepository();
    const source = createSource();

    const result = stageRailwayIacSource({
      sourcePath: source.path,
      repositoryRoot: repository,
      write: true,
    });

    expect(result).toEqual({
      ok: true,
      mode: "staged",
      bytes: Buffer.byteLength(SAFE_SOURCE),
      sha256: createHash("sha256").update(SAFE_SOURCE).digest("hex"),
    });
    expect(
      readFileSync(join(repository, STAGED_RAILWAY_IAC_PATH), "utf8"),
    ).toBe(SAFE_SOURCE);
  });

  it("never overwrites an already staged file", () => {
    const repository = createRepository();
    const firstSource = createSource();
    const secondSource = createSource(`${SAFE_SOURCE}\n`);

    expect(
      stageRailwayIacSource({
        sourcePath: firstSource.path,
        repositoryRoot: repository,
        write: true,
      }).ok,
    ).toBe(true);
    const destination = join(repository, STAGED_RAILWAY_IAC_PATH);
    const before = readFileSync(destination);

    expect(
      stageRailwayIacSource({
        sourcePath: secondSource.path,
        repositoryRoot: repository,
        write: true,
      }),
    ).toEqual({ ok: false, reason: "destination-already-exists" });
    expect(readFileSync(destination)).toEqual(before);
  });

  it("rejects a source inside the repository", () => {
    const repository = createRepository();
    const inside = join(repository, "railway.ts");
    writeFileSync(inside, SAFE_SOURCE);
    expect(
      stageRailwayIacSource({
        sourcePath: inside,
        repositoryRoot: repository,
        write: false,
      }),
    ).toEqual({ ok: false, reason: "source-must-be-outside-repository" });
  });

  it("requires the pulled source to be named railway.ts", () => {
    const repository = createRepository();
    const source = createSource(SAFE_SOURCE, "generated.ts");
    expect(
      stageRailwayIacSource({
        sourcePath: source.path,
        repositoryRoot: repository,
        write: false,
      }),
    ).toEqual({ ok: false, reason: "source-must-be-railway-ts" });
  });

  it("rejects a source containing a raw secret", () => {
    const repository = createRepository();
    const source = createSource(
      'import { service } from "railway/iac"; service("online", { env: { ONLINE_OPS_TOKEN: "raw" } });',
    );
    expect(
      stageRailwayIacSource({
        sourcePath: source.path,
        repositoryRoot: repository,
        write: false,
      }),
    ).toEqual({ ok: false, reason: "source-failed-secret-safety-check" });
  });

  it("requires the pulled source to expose a defineRailway entrypoint", () => {
    const repository = createRepository();
    const source = createSource("const config = {};\n");
    expect(
      stageRailwayIacSource({
        sourcePath: source.path,
        repositoryRoot: repository,
        write: false,
      }),
    ).toEqual({ ok: false, reason: "source-is-not-railway-iac" });
  });

  it("accepts defineRailway when railway imports are split across declarations", () => {
    const repository = createRepository();
    const source = createSource(
      SAFE_SOURCE.replace(
        'import { defineRailway, project, service } from "railway/iac";',
        'import { defineRailway } from "railway/iac";\nimport { project, service } from "railway/iac";',
      ),
    );

    const result = stageRailwayIacSource({
      sourcePath: source.path,
      repositoryRoot: repository,
      write: false,
    });

    expect(result).toMatchObject({ ok: true, mode: "validated" });
  });

  it("rejects symlinked or oversized sources before parsing", () => {
    const repository = createRepository();
    const source = createSource();
    const symlinkPath = join(source.directory, "link.ts");
    symlinkSync(source.path, symlinkPath);
    expect(
      stageRailwayIacSource({
        sourcePath: symlinkPath,
        repositoryRoot: repository,
        write: false,
      }),
    ).toEqual({ ok: false, reason: "source-not-found-or-unsafe" });

    const oversized = createSource("x".repeat(64 * 1_024 + 1));
    expect(
      stageRailwayIacSource({
        sourcePath: oversized.path,
        repositoryRoot: repository,
        write: false,
      }),
    ).toEqual({ ok: false, reason: "source-not-found-or-unsafe" });
  });

  it("rejects malformed UTF-8 and an unsafe destination parent", () => {
    const repository = createRepository();
    const source = createSource();
    writeFileSync(source.path, Buffer.from([0xc3, 0x28]));
    expect(
      stageRailwayIacSource({
        sourcePath: source.path,
        repositoryRoot: repository,
        write: false,
      }),
    ).toEqual({ ok: false, reason: "source-is-not-utf8" });

    const safeSource = createSource();
    const outsideDirectory = mkdtempSync(
      join(tmpdir(), "railway-iac-stage-outside-"),
    );
    temporaryDirectories.push(outsideDirectory);
    symlinkSync(outsideDirectory, join(repository, ".railway"), "dir");
    expect(
      stageRailwayIacSource({
        sourcePath: safeSource.path,
        repositoryRoot: repository,
        write: true,
      }),
    ).toEqual({ ok: false, reason: "destination-parent-unsafe" });
    expect(() => lstatSync(join(outsideDirectory, "railway.ts"))).toThrow();
  });

  it("does not treat a non-directory repository root as writable", () => {
    const source = createSource();
    const fileRoot = join(source.directory, "root-file");
    writeFileSync(fileRoot, "not a directory");

    expect(
      stageRailwayIacSource({
        sourcePath: source.path,
        repositoryRoot: fileRoot,
        write: true,
      }),
    ).toEqual({ ok: false, reason: "source-not-found-or-unsafe" });
  });
});
