import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  dependabotViolations,
  dockerfileIgnoreOverrideViolations,
  dockerfileViolations,
  dockerignoreViolations,
  FORBIDDEN_NESTED_LOCKFILES,
  knipWorkspaceViolations,
  nestedLockfileViolations,
  ONLINE_RUNTIME_PACKAGE_NAME,
  type PackageManifest,
  REQUIRED_DOCKERIGNORE_PATTERNS,
  runtimeWorkspaceViolations,
} from "./dockerHardeningContract";

const REPOSITORY_ROOT = process.cwd();

function readJsonOrNull(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readYamlOrNull(path: string): unknown {
  try {
    return parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

describe("Docker hardening repository contract (#734)", () => {
  it("pins every non-scratch base and selects a non-root final user", () => {
    const source = readFileSync(resolve(REPOSITORY_ROOT, "Dockerfile"), "utf8");
    const root = readJsonOrNull(
      resolve(REPOSITORY_ROOT, "package.json"),
    ) as PackageManifest | null;
    expect(
      dockerfileViolations(
        source,
        ONLINE_RUNTIME_PACKAGE_NAME,
        String(root?.packageManager),
      ),
    ).toEqual([]);
  });

  it("isolates the online runtime in a minimal pnpm workspace package", () => {
    expect(
      runtimeWorkspaceViolations(
        readJsonOrNull(resolve(REPOSITORY_ROOT, "package.json")),
        readJsonOrNull(
          resolve(REPOSITORY_ROOT, "container/online/package.json"),
        ),
        readYamlOrNull(resolve(REPOSITORY_ROOT, "pnpm-workspace.yaml")),
        readYamlOrNull(resolve(REPOSITORY_ROOT, "pnpm-lock.yaml")),
      ),
    ).toEqual([]);
    expect(
      nestedLockfileViolations(
        readdirSync(resolve(REPOSITORY_ROOT, "container/online")),
      ),
    ).toEqual([]);
  });

  it("rejects runtime dependency or workspace drift", () => {
    const root = {
      name: "soshina-majong",
      dependencies: { tsx: "^4.23.12", ws: "^8.21.3" },
    };
    const runtime = {
      name: ONLINE_RUNTIME_PACKAGE_NAME,
      private: true,
      type: "module",
      dependencies: { tsx: "^4.23.12", ws: "^8.21.3" },
    };
    const workspace = {
      injectWorkspacePackages: true,
      packages: ["container/*"],
    };
    const lockfile = {
      settings: { injectWorkspacePackages: true },
      importers: {
        ".": {
          dependencies: {
            tsx: { specifier: "^4.23.12", version: "4.23.12" },
            ws: { specifier: "^8.21.3", version: "8.21.3" },
          },
        },
        "container/online": {
          dependencies: {
            tsx: { specifier: "^4.23.12", version: "4.23.12" },
            ws: { specifier: "^8.21.3", version: "8.21.3" },
          },
        },
      },
    };
    expect(
      runtimeWorkspaceViolations(root, runtime, workspace, lockfile),
    ).toEqual([]);
    expect(
      runtimeWorkspaceViolations(
        root,
        { ...runtime, dependencies: { ...runtime.dependencies, next: "16" } },
        workspace,
        lockfile,
      ),
    ).toContain("runtime dependencies must contain exactly tsx and ws");
    expect(
      runtimeWorkspaceViolations(
        root,
        { ...runtime, dependencies: { ...runtime.dependencies, ws: "^9" } },
        workspace,
        lockfile,
      ),
    ).toContain("runtime ws specifier must equal the root package specifier");
    expect(
      runtimeWorkspaceViolations(
        root,
        { ...runtime, private: false },
        workspace,
        lockfile,
      ),
    ).toContain(
      "runtime package must have the canonical name, private=true, and type=module",
    );
    expect(
      runtimeWorkspaceViolations(
        root,
        { ...runtime, name: root.name },
        workspace,
        lockfile,
      ),
    ).toContain(
      "runtime package must have the canonical name, private=true, and type=module",
    );
    expect(
      runtimeWorkspaceViolations(
        root,
        { ...runtime, devDependencies: {} },
        workspace,
        lockfile,
      ),
    ).toContain("runtime package must contain only runtime metadata");
    for (const extraKey of [
      "scripts",
      "bin",
      "main",
      "exports",
      "packageManager",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      expect(
        runtimeWorkspaceViolations(
          root,
          { ...runtime, [extraKey]: {} },
          workspace,
          lockfile,
        ),
      ).toContain("runtime package must contain only runtime metadata");
    }
    expect(
      runtimeWorkspaceViolations(
        root,
        runtime,
        { injectWorkspacePackages: true, packages: ["src/*"] },
        lockfile,
      ),
    ).toContain("pnpm workspace must include container/online");
    expect(
      runtimeWorkspaceViolations(
        root,
        runtime,
        {
          injectWorkspacePackages: true,
          packages: ["container/*", "!container/online"],
        },
        lockfile,
      ),
    ).toContain("pnpm workspace must include container/online");
    expect(
      runtimeWorkspaceViolations(root, runtime, workspace, {
        settings: { injectWorkspacePackages: true },
        importers: {},
      }),
    ).toContain("lockfile runtime importer must contain exactly tsx and ws");
    expect(
      runtimeWorkspaceViolations(root, runtime, workspace, {
        settings: { injectWorkspacePackages: true },
        importers: {
          "container/online": {
            dependencies: {
              tsx: { specifier: "^4.23.11" },
              ws: { specifier: "^8.21.3" },
            },
          },
        },
      }),
    ).toContain(
      "lockfile runtime tsx specifier must equal its package manifest",
    );
    expect(
      runtimeWorkspaceViolations(root, runtime, workspace, {
        ...lockfile,
        importers: {
          ...lockfile.importers,
          "container/online": {
            dependencies: {
              ...lockfile.importers["container/online"].dependencies,
              ws: { specifier: "^8.21.3", version: "8.20.0" },
            },
          },
        },
      }),
    ).toContain("lockfile runtime ws version must equal the root lock version");
    expect(
      runtimeWorkspaceViolations(root, runtime, workspace, {
        ...lockfile,
        importers: {
          ...lockfile.importers,
          ".": {
            dependencies: {
              ...lockfile.importers["."].dependencies,
              ws: { specifier: "^8.20.0", version: "8.21.3" },
            },
          },
        },
      }),
    ).toContain(
      "lockfile root ws specifier must equal the root package manifest",
    );
    expect(
      runtimeWorkspaceViolations(
        root,
        runtime,
        { packages: ["container/online"] },
        lockfile,
      ),
    ).toContain("pnpm workspace must inject workspace packages");
    expect(
      runtimeWorkspaceViolations(root, runtime, workspace, {
        ...lockfile,
        settings: { injectWorkspacePackages: false },
      }),
    ).toContain("lockfile must record injectWorkspacePackages=true");
    expect(nestedLockfileViolations([])).toEqual([]);
    for (const filename of FORBIDDEN_NESTED_LOCKFILES) {
      expect(nestedLockfileViolations([filename])).toEqual([
        `nested package-manager lockfile is forbidden: ${filename}`,
      ]);
    }
  });

  it("keeps the runtime-only knip exception narrow", () => {
    expect(
      knipWorkspaceViolations(
        readJsonOrNull(resolve(REPOSITORY_ROOT, "knip.json")),
      ),
    ).toEqual([]);
  });

  it("rejects global, extra-workspace, or extra-dependency knip ignores", () => {
    const valid = {
      workspaces: {
        "container/online": { ignoreDependencies: ["tsx", "ws"] },
      },
    };
    expect(knipWorkspaceViolations(valid)).toEqual([]);
    expect(
      knipWorkspaceViolations({ ...valid, ignoreDependencies: ["tsx"] }),
    ).toContain("knip must not ignore dependencies globally");
    expect(
      knipWorkspaceViolations({
        workspaces: { ...valid.workspaces, ".": {} },
      }),
    ).toContain("knip must configure only container/online");
    expect(
      knipWorkspaceViolations({
        workspaces: {
          "container/online": {
            ignoreDependencies: ["next", "tsx", "ws"],
          },
        },
      }),
    ).toContain("knip runtime workspace must ignore exactly tsx and ws");
  });

  it("rejects unconsumed deploy stages, broad copies, or root final stages", () => {
    const digest = "a".repeat(64);
    const runtimePackageName = ONLINE_RUNTIME_PACKAGE_NAME;
    const valid = `FROM node:24.15.0-slim@sha256:${digest} AS dependencies
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY container/online/package.json ./container/online/package.json
RUN pnpm --filter ${runtimePackageName} --fail-if-no-match install --prod --frozen-lockfile \
    && pnpm --filter=${runtimePackageName} --fail-if-no-match deploy --prod /runtime
FROM node:24.15.0-slim@sha256:${digest}
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies /runtime/node_modules ./node_modules
COPY --from=dependencies /runtime/package.json ./package.json
COPY tsconfig.json ./
COPY server ./server
COPY src ./src
USER node
EXPOSE 8080
CMD ["node", "--import", "tsx", "server/start.ts"]`;
    expect(dockerfileViolations(valid, runtimePackageName)).toEqual([]);
    const expectViolation = (mutated: string, message: string) => {
      expect(
        dockerfileViolations(mutated, runtimePackageName).join("\n"),
      ).toContain(message);
    };
    expectViolation("FROM node:24.15.0-slim\nUSER node", "FROM must use");
    expectViolation(
      "ARG BASE=node:24.15.0-slim\nFROM ${BASE}\nUSER node",
      "FROM must use",
    );
    expectViolation(
      `FROM --platform=linux/amd64 node:24.15.0-slim@sha256:${digest}\nUSER node`,
      "FROM must use",
    );
    expectViolation(
      `FROM node:24.15.0-slim@sha256:${"a".repeat(63)}\nUSER node`,
      "FROM must use",
    );
    expectViolation(
      `${valid}\nFROM node:24.15.0-slim\nUSER node`,
      "FROM must use",
    );
    for (const mutation of [
      `FROM node:24.15.0-slim@sha256:${digest}`,
      `FROM node:24.15.0-slim@sha256:${digest}\nUSER root`,
      `FROM node:24.15.0-slim@sha256:${digest}\nUSER node\nUSER 0:0`,
    ]) {
      expectViolation(
        mutation,
        "final stage must select an explicit non-root USER",
      );
    }
    expectViolation(`${valid}\nADD . /app`, "Dockerfile must not use ADD");
    for (const copy of [
      "COPY . .",
      "COPY ./ ./",
      'COPY [".", "/app"]',
      "COPY server/* ./server",
    ]) {
      expectViolation(
        `${valid}\n${copy}`,
        "Dockerfile must not use a broad or wildcard COPY source",
      );
    }
    for (const copyFlag of [
      "--chown=node:node",
      "--chmod=0777",
      "--link --chown=node:node",
    ]) {
      expectViolation(
        valid.replace(
          "COPY server ./server",
          `COPY ${copyFlag} server ./server`,
        ),
        "Dockerfile COPY flags must be absent except for one exact --from",
      );
    }
    expectViolation(
      valid.replace(
        "COPY --from=dependencies /runtime/node_modules",
        "COPY --from=dependencies --chown=node:node /runtime/node_modules",
      ),
      "Dockerfile COPY flags must be absent except for one exact --from",
    );
    const installContract =
      "consumed deploy stage must frozen-install only the production runtime workspace";
    expectViolation(valid.replace(" --frozen-lockfile", ""), installContract);
    expectViolation(
      valid.replace(
        `${runtimePackageName} --fail-if-no-match install`,
        `${runtimePackageName} install`,
      ),
      installContract,
    );
    expectViolation(
      valid.replace(`--filter ${runtimePackageName} `, ""),
      installContract,
    );
    expectViolation(
      valid.replace(
        `RUN pnpm --filter ${runtimePackageName} --fail-if-no-match install --prod --frozen-lockfile`,
        `RUN echo "pnpm --filter ${runtimePackageName} --fail-if-no-match install --prod --frozen-lockfile"`,
      ),
      installContract,
    );
    const deployContract =
      "consumed deploy stage must deploy only the production runtime workspace";
    expectViolation(valid.replace("deploy --prod", "deploy"), deployContract);
    expectViolation(
      valid.replace("--fail-if-no-match deploy", "deploy"),
      deployContract,
    );
    expectViolation(
      valid.replace(`--filter=${runtimePackageName} `, ""),
      deployContract,
    );
    expectViolation(valid.replace(" /runtime", " /elsewhere"), deployContract);
    expectViolation(
      valid.replace(
        `pnpm --filter=${runtimePackageName} --fail-if-no-match deploy --prod /runtime`,
        `echo "pnpm --filter=${runtimePackageName} --fail-if-no-match deploy --prod /runtime"`,
      ),
      deployContract,
    );
    expectViolation(
      valid.replace("deploy --prod", "deploy --prod --legacy"),
      "consumed deploy stage must use modern workspace deploy",
    );
    expectViolation(
      valid.replace("COPY server ./server\n", ""),
      "required explicit final-stage COPY is missing: server ./server",
    );
    expectViolation(
      valid.replace(
        "COPY --from=dependencies /runtime/node_modules ./node_modules\nCOPY --from=dependencies /runtime/package.json ./package.json",
        "COPY --from=dependencies /runtime ./",
      ),
      "final stage must copy only /runtime package.json and node_modules from one deploy stage",
    );
    const unconsumedSafeStage = valid
      .replaceAll("--from=dependencies", "--from=unsafe-dependencies")
      .replace(
        `FROM node:24.15.0-slim@sha256:${digest}\n`,
        `FROM node:24.15.0-slim@sha256:${digest} AS unsafe-dependencies\nRUN pnpm install --prod --frozen-lockfile\nFROM node:24.15.0-slim@sha256:${digest}\n`,
      );
    expectViolation(unconsumedSafeStage, deployContract);
    expectViolation(
      valid.replace("USER node", "RUN pnpm install --prod\nUSER node"),
      "final stage must not run a package manager",
    );
    const exactDependenciesContract =
      "dependencies stage must contain only the ordered runtime install and deploy contract";
    expectViolation(
      valid.replace(
        `COPY container/online/package.json ./container/online/package.json\nRUN pnpm --filter ${runtimePackageName}`,
        `COPY container/online/package.json ./container/online/package.json\nRUN echo poisoned >> /runtime/package.json\nRUN pnpm --filter ${runtimePackageName}`,
      ),
      exactDependenciesContract,
    );
    expectViolation(
      valid.replace("USER node", "RUN echo poisoned\nUSER node"),
      "final stage must contain only the exact immutable runtime instructions",
    );
    expect(
      dockerfileViolations(valid, runtimePackageName, "pnpm@10.32.0"),
    ).toContain(
      "the dependencies stage must contain only the ordered runtime install and deploy contract",
    );
    expectViolation(
      valid.replace(
        'CMD ["node", "--import", "tsx", "server/start.ts"]',
        'CMD ["pnpm", "server:start"]',
      ),
      "final stage must launch the server as the direct Node PID1",
    );
    expectViolation(
      valid.replace(
        'CMD ["node", "--import", "tsx", "server/start.ts"]',
        'ENTRYPOINT ["pnpm"]\nCMD ["server:start"]',
      ),
      "final stage must launch the server as the direct Node PID1",
    );
    expectViolation(
      valid.replace(
        `FROM node:24.15.0-slim@sha256:${digest}\nENV NODE_ENV=production`,
        `FROM node:24.15.0-slim@sha256:${digest} AS dependencies\n`,
      ),
      "Dockerfile stage aliases must be unique",
    );
  });

  it("excludes secrets and test-only source files from the build context", () => {
    const source = readFileSync(
      resolve(REPOSITORY_ROOT, ".dockerignore"),
      "utf8",
    );
    expect(dockerignoreViolations(source)).toEqual([]);
  });

  it("rejects every missing required ignore rule or any re-include", () => {
    const valid = REQUIRED_DOCKERIGNORE_PATTERNS.join("\n");
    expect(dockerignoreViolations(valid)).toEqual([]);
    for (const missing of REQUIRED_DOCKERIGNORE_PATTERNS) {
      const mutation = REQUIRED_DOCKERIGNORE_PATTERNS.filter(
        (pattern) => pattern !== missing,
      ).join("\n");
      expect(dockerignoreViolations(mutation)).toContain(
        `required dockerignore rule is missing: ${missing}`,
      );
    }
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

  it("covers both pnpm manifests and the root Dockerfile with Dependabot", () => {
    const source = readFileSync(
      resolve(REPOSITORY_ROOT, ".github/dependabot.yml"),
      "utf8",
    );
    expect(dependabotViolations(parse(source))).toEqual([]);
  });

  it("rejects missing, duplicate, misplaced, or incomplete Dependabot updates", () => {
    const dockerUpdate = {
      "package-ecosystem": "docker",
      directory: "/",
      schedule: { interval: "weekly" },
    };
    const npmUpdate = {
      "package-ecosystem": "npm",
      directories: ["/", "/container/online"],
      schedule: { interval: "daily" },
    };
    expect(
      dependabotViolations({
        version: 2,
        updates: [npmUpdate, dockerUpdate],
      }),
    ).toEqual([]);
    expect(dependabotViolations({ version: 2, updates: [] })).toContain(
      "Dependabot must contain exactly one Docker ecosystem entry",
    );
    expect(
      dependabotViolations({
        version: 2,
        updates: [npmUpdate, dockerUpdate, dockerUpdate],
      }),
    ).toContain("Dependabot must contain exactly one Docker ecosystem entry");
    expect(
      dependabotViolations({
        version: 2,
        updates: [npmUpdate, { ...dockerUpdate, directory: "/server" }],
      }),
    ).toContain('Dependabot Docker directory must be "/"');
    expect(
      dependabotViolations({
        version: 2,
        updates: [npmUpdate, { ...dockerUpdate, schedule: undefined }],
      }),
    ).toContain(
      "Dependabot Docker entry must have a supported periodic schedule",
    );
    expect(
      dependabotViolations({
        version: 2,
        updates: [{ ...npmUpdate, schedule: undefined }, dockerUpdate],
      }),
    ).toContain("Dependabot npm entry must have a supported periodic schedule");
    expect(
      dependabotViolations({
        version: 2,
        updates: [{ ...npmUpdate, directories: ["/"] }, dockerUpdate],
      }),
    ).toContain(
      "Dependabot npm directories must contain exactly / and /container/online",
    );
  });
});
