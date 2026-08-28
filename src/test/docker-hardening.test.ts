import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const REPOSITORY_ROOT = process.cwd();
const PINNED_NODE_IMAGE =
  /^node:\d+\.\d+\.\d+-[a-z0-9][a-z0-9._-]*@sha256:[a-f0-9]{64}$/;
const REQUIRED_DOCKERIGNORE_PATTERNS = [
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
  ".npmrc",
  "**/.npmrc",
  "*.pem",
  "**/*.pem",
  "*.key",
  "**/*.key",
] as const;

interface DockerInstruction {
  readonly name: string;
  readonly value: string;
}

interface DependabotUpdate {
  readonly "package-ecosystem"?: unknown;
  readonly directory?: unknown;
  readonly schedule?: { readonly interval?: unknown };
}

interface DependabotConfig {
  readonly version?: unknown;
  readonly updates?: unknown;
}

function dockerInstructions(source: string): readonly DockerInstruction[] {
  const logicalLines: string[] = [];
  let continuation = "";

  for (const rawLine of source.replaceAll("\r\n", "\n").split("\n")) {
    const trimmed = rawLine.trim();
    if (
      continuation.length === 0 &&
      (trimmed.length === 0 || trimmed.startsWith("#"))
    ) {
      continue;
    }
    const continued = trimmed.endsWith("\\");
    const fragment = continued ? trimmed.slice(0, -1).trimEnd() : trimmed;
    continuation =
      continuation.length === 0 ? fragment : `${continuation} ${fragment}`;
    if (continued) continue;
    logicalLines.push(continuation);
    continuation = "";
  }
  if (continuation.length > 0) logicalLines.push(continuation);

  return logicalLines.map((line) => {
    const match = line.match(/^([a-z]+)\s+(.+)$/i);
    if (!match?.[1] || !match[2]) {
      return { name: "INVALID", value: line };
    }
    return { name: match[1].toUpperCase(), value: match[2].trim() };
  });
}

function fromImage(value: string): string | null {
  const tokens = value.split(/\s+/);
  while (tokens[0]?.startsWith("--")) tokens.shift();
  const image = tokens.shift();
  if (!image) return null;
  if (tokens.length === 0) return image;
  if (tokens.length === 2 && tokens[0]?.toUpperCase() === "AS" && tokens[1]) {
    return image;
  }
  return null;
}

function isExplicitNonRootUser(value: string): boolean {
  const [user, group, ...extra] = value.split(":");
  if (!user || extra.length > 0) return false;
  const validUser = user === "node" || /^[1-9]\d*$/.test(user);
  const validGroup =
    group === undefined || group === "node" || /^[1-9]\d*$/.test(group);
  return validUser && validGroup;
}

function dockerfileViolations(source: string): readonly string[] {
  const instructions = dockerInstructions(source);
  const fromIndexes = instructions.flatMap((instruction, index) =>
    instruction.name === "FROM" ? [index] : [],
  );
  const violations: string[] = [];

  if (fromIndexes.length === 0) {
    violations.push("Dockerfile must contain a FROM instruction");
    return violations;
  }

  for (const index of fromIndexes) {
    const instruction = instructions[index];
    const image = instruction ? fromImage(instruction.value) : null;
    if (image === "scratch") continue;
    if (image === null || !PINNED_NODE_IMAGE.test(image)) {
      violations.push(
        `FROM must use a readable Node tag pinned by a lowercase sha256 digest: ${instruction?.value ?? ""}`,
      );
    }
  }

  const finalStage = instructions.slice(fromIndexes.at(-1));
  const finalUser = finalStage
    .filter((instruction) => instruction.name === "USER")
    .at(-1);
  if (!finalUser || !isExplicitNonRootUser(finalUser.value)) {
    violations.push("the final stage must select an explicit non-root USER");
  }
  return violations;
}

function dockerignoreViolations(source: string): readonly string[] {
  const patterns = source
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  const violations = patterns
    .filter((pattern) => pattern.startsWith("!"))
    .map((pattern) => `negated dockerignore rule is forbidden: ${pattern}`);
  const patternSet = new Set(patterns);
  for (const required of REQUIRED_DOCKERIGNORE_PATTERNS) {
    if (!patternSet.has(required)) {
      violations.push(`required dockerignore rule is missing: ${required}`);
    }
  }
  return violations;
}

function dockerfileIgnoreOverrideViolations(
  filenames: readonly string[],
): readonly string[] {
  return filenames
    .filter(
      (filename) =>
        filename !== ".dockerignore" && filename.endsWith(".dockerignore"),
    )
    .map(
      (filename) =>
        `Dockerfile-specific ignore override is forbidden: ${filename}`,
    );
}

function dependabotViolations(value: unknown): readonly string[] {
  if (value === null || typeof value !== "object") {
    return ["Dependabot config must be an object"];
  }
  const config = value as DependabotConfig;
  if (config.version !== 2 || !Array.isArray(config.updates)) {
    return ["Dependabot config must use version 2 with an updates array"];
  }
  const dockerUpdates = (config.updates as readonly DependabotUpdate[]).filter(
    (update) => update?.["package-ecosystem"] === "docker",
  );
  if (dockerUpdates.length !== 1) {
    return ["Dependabot must contain exactly one Docker ecosystem entry"];
  }
  const update = dockerUpdates[0];
  const violations: string[] = [];
  if (update?.directory !== "/") {
    violations.push('Dependabot Docker directory must be "/"');
  }
  if (
    !["daily", "weekly", "monthly"].includes(String(update?.schedule?.interval))
  ) {
    violations.push(
      "Dependabot Docker entry must have a supported periodic schedule",
    );
  }
  return violations;
}

describe("Docker hardening repository contract (#734)", () => {
  it("pins every non-scratch base and selects a non-root final user", () => {
    const source = readFileSync(resolve(REPOSITORY_ROOT, "Dockerfile"), "utf8");
    expect(dockerfileViolations(source)).toEqual([]);
  });

  it("rejects unpinned, malformed, indirect, or root Dockerfile mutations", () => {
    const digest = "a".repeat(64);
    const valid = `FROM node:24.15.0-slim@sha256:${digest}\nUSER node\nCMD ["node"]`;
    expect(dockerfileViolations(valid)).toEqual([]);
    expect(
      dockerfileViolations(`FROM node:24.15.0-slim\nUSER node`),
    ).toContainEqual(expect.stringContaining("FROM must use"));
    expect(
      dockerfileViolations(
        `ARG BASE=node:24.15.0-slim\nFROM \${BASE}\nUSER node`,
      ),
    ).toContainEqual(expect.stringContaining("FROM must use"));
    expect(
      dockerfileViolations(
        `FROM node:24.15.0-slim@sha256:${"a".repeat(63)}\nUSER node`,
      ),
    ).toContainEqual(expect.stringContaining("FROM must use"));
    expect(
      dockerfileViolations(`${valid}\nFROM node:24.15.0-slim\nUSER node`),
    ).toContainEqual(expect.stringContaining("FROM must use"));
    expect(
      dockerfileViolations(`FROM node:24.15.0-slim@sha256:${digest}`),
    ).toContain("the final stage must select an explicit non-root USER");
    expect(
      dockerfileViolations(
        `FROM node:24.15.0-slim@sha256:${digest}\nUSER root`,
      ),
    ).toContain("the final stage must select an explicit non-root USER");
    expect(
      dockerfileViolations(
        `FROM node:24.15.0-slim@sha256:${digest}\nUSER node\nUSER 0:0`,
      ),
    ).toContain("the final stage must select an explicit non-root USER");
  });

  it("excludes root and nested environment, registry, and private-key files", () => {
    const source = readFileSync(
      resolve(REPOSITORY_ROOT, ".dockerignore"),
      "utf8",
    );
    expect(dockerignoreViolations(source)).toEqual([]);
  });

  it("rejects a missing required ignore rule or any re-include", () => {
    const valid = REQUIRED_DOCKERIGNORE_PATTERNS.join("\n");
    expect(dockerignoreViolations(valid)).toEqual([]);
    expect(dockerignoreViolations(valid.replace("**/.env.*\n", ""))).toContain(
      "required dockerignore rule is missing: **/.env.*",
    );
    expect(dockerignoreViolations(`${valid}\n!nested/.env.local`)).toContain(
      "negated dockerignore rule is forbidden: !nested/.env.local",
    );
    expect(dockerignoreViolations(`${valid}\n!**`)).toContain(
      "negated dockerignore rule is forbidden: !**",
    );
  });

  it("rejects Dockerfile-specific ignore files that override the root policy", () => {
    const rootFiles = readdirSync(REPOSITORY_ROOT);
    expect(dockerfileIgnoreOverrideViolations(rootFiles)).toEqual([]);
    expect(
      dockerfileIgnoreOverrideViolations([
        ".dockerignore",
        "Dockerfile.dockerignore",
      ]),
    ).toEqual([
      "Dockerfile-specific ignore override is forbidden: Dockerfile.dockerignore",
    ]);
    expect(
      dockerfileIgnoreOverrideViolations(["lint.Dockerfile.dockerignore"]),
    ).toEqual([
      "Dockerfile-specific ignore override is forbidden: lint.Dockerfile.dockerignore",
    ]);
  });

  it("keeps one scheduled root Docker ecosystem Dependabot entry", () => {
    const source = readFileSync(
      resolve(REPOSITORY_ROOT, ".github/dependabot.yml"),
      "utf8",
    );
    expect(dependabotViolations(parse(source))).toEqual([]);
  });

  it("rejects missing, duplicate, misplaced, or unscheduled Docker updates", () => {
    const update = {
      "package-ecosystem": "docker",
      directory: "/",
      schedule: { interval: "weekly" },
    };
    expect(dependabotViolations({ version: 2, updates: [update] })).toEqual([]);
    expect(dependabotViolations({ version: 2, updates: [] })).toContain(
      "Dependabot must contain exactly one Docker ecosystem entry",
    );
    expect(
      dependabotViolations({ version: 2, updates: [update, update] }),
    ).toContain("Dependabot must contain exactly one Docker ecosystem entry");
    expect(
      dependabotViolations({
        version: 2,
        updates: [{ ...update, directory: "/server" }],
      }),
    ).toContain('Dependabot Docker directory must be "/"');
    expect(
      dependabotViolations({
        version: 2,
        updates: [{ ...update, schedule: undefined }],
      }),
    ).toContain(
      "Dependabot Docker entry must have a supported periodic schedule",
    );
  });
});
