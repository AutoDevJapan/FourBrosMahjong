import { createHash } from "node:crypto";
import ts from "typescript";
import { parseStrictJson } from "./strictJson";

/** One existing service in a shared project; never whole-project ownership. */
export const FOURBROS_IAC_TARGET = Object.freeze({
  projectId: "72632f6a-ce4d-4acd-89c8-ec798132baa7",
  projectName: "godd-genesis",
  environmentId: "703cd34a-de40-42a8-ae72-674fb60e2e88",
  environmentName: "production",
  serviceId: "9f7f42d2-7383-4201-b4d8-efeb054b301c",
  serviceName: "four-bros-mahjong-online",
});
export const FOURBROS_IAC_PARTIAL = "four-bros-mahjong-online";
export const FOURBROS_IAC_ADDRESS = `service.${FOURBROS_IAC_TARGET.serviceName}`;
const FOURBROS_IAC_SDK_VERSION = "3.16.0";
// SHA-256 of dist/iac/index.d.ts + NUL + its exported shared declaration file.
export const FOURBROS_IAC_SDK_SCHEMA_SHA256 =
  "e154a2beae34557bdfb456b40dc5810bc07739d7ed46cfc498b1079da5a4f3ce";

type RecordValue = Record<string, unknown>;
export type NamedPartialReason =
  | "invalid-schema"
  | "clock-invalid"
  | "evidence-stale"
  | "target-identity-invalid"
  | "cli-capability-unverified"
  | "sdk-schema-unverified"
  | "generated-iac-invalid"
  | "source-provenance-invalid"
  | "secret-safety-unverified"
  | "legacy-config-missing"
  | "alternate-legacy-config-present"
  | "ownership-cutover-unverified"
  | "partial-ownership-invalid"
  | "resource-inventory-mismatch"
  | "pinned-plan-unverified"
  | "native-plan-invalid"
  | "runtime-changes-outside-allowlist"
  | "parity-plan-not-clean";

export interface NamedPartialFilesystem {
  generatedIacPath: string | null;
  generatedIacSha256: string | null;
  generatedIacSecretSafe: boolean | null;
  generatedIacSource?: string | null;
  generatedIacTreeSha1?: string | null;
  sdkPackageVersion?: string | null;
  sdkSchemaSha256?: string | null;
  currentRepositoryFilePresent: boolean;
  currentRepositoryFileContent: string | null;
  currentRepositoryFileSha256: string | null;
  /** Required by schema v2; omitted historical v1 snapshots stay compatible. */
  legacyJsonFilePresent?: boolean;
  legacyTomlFilePresent: boolean;
  legacyFixturePresent: boolean;
  legacyFixtureContent: string | null;
  legacyFixtureSha256: string | null;
}

export function iacSha256(source: string | Buffer): string {
  return createHash("sha256").update(source).digest("hex");
}

/** Git's single-file .railway tree, without writing objects or an index. */
export function singleFileIacTree(source: string | Buffer): string {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source);
  const blob = createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest();
  const entry = Buffer.concat([Buffer.from("100644 railway.ts\0"), blob]);
  return createHash("sha1")
    .update(`tree ${entry.length}\0`)
    .update(entry)
    .digest("hex");
}

function record(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value: unknown, keys: readonly string[]): value is RecordValue {
  return (
    record(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right))
    return (
      left.length === right.length && left.every((v, i) => equal(v, right[i]))
    );
  return (
    record(left) &&
    record(right) &&
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every(
      (key) => Object.hasOwn(right, key) && equal(left[key], right[key]),
    )
  );
}
function stableVersion(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  if (!parts.every(Number.isSafeInteger)) return false;
  return (
    parts[0]! > 5 ||
    (parts[0] === 5 && (parts[1]! > 42 || (parts[1] === 42 && parts[2]! >= 1)))
  );
}
function fresh(value: unknown, now: number): boolean {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return (
    Number.isFinite(time) &&
    new Date(time).toISOString() === value &&
    time <= now + 30_000 &&
    now - time <= 300_000
  );
}
function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function addresses(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 100 &&
    value.every(
      (v) =>
        typeof v === "string" &&
        /^(?:service|database|volume|bucket|group)\.[A-Za-z0-9_.-]{1,128}$/.test(
          v,
        ),
    ) &&
    new Set(value).size === value.length
  );
}
function sameAddresses(left: unknown, right: unknown): boolean {
  return (
    addresses(left) &&
    addresses(right) &&
    equal([...left].sort(), [...right].sort())
  );
}
function authoringPath(value: unknown): boolean {
  if (typeof value !== "string" || value.includes("\0")) return false;
  const path = value.replaceAll("\\", "/").replace(/^\/\/\?\//, "");
  return (
    !path.split("/").some((part) => part === ".." || part === ".") &&
    /(?:^|\/)\.railway\/railway\.ts$/.test(path)
  );
}
function literal(node: ts.Expression): unknown {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (!ts.isObjectLiteralExpression(node)) throw new Error("non-literal");
  const result: RecordValue = {};
  for (const property of node.properties) {
    if (
      !ts.isPropertyAssignment(property) ||
      !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    )
      throw new Error("non-static-property");
    const name = property.name.text;
    if (
      Object.hasOwn(result, name) ||
      ["__proto__", "constructor", "prototype"].includes(name)
    )
      throw new Error("duplicate-property");
    result[name] = literal(property.initializer);
  }
  return result;
}

export interface NamedPartialDefinition {
  readonly serviceConfig: RecordValue;
  readonly build: RecordValue;
  readonly deploy: RecordValue;
}

/** Interpret only CLI-generated literal DSL structure, never execute source. */
export function inspectNamedPartialSource(
  source: string,
): NamedPartialDefinition | null {
  if (Buffer.byteLength(source) > 65_536) return null;
  try {
    const file = ts.createSourceFile(
      "railway.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
    );
    const imports = new Set<string>();
    let partial: unknown;
    let callback: ts.ArrowFunction | undefined;
    for (const statement of file.statements) {
      if (ts.isImportDeclaration(statement)) {
        if (
          !ts.isStringLiteral(statement.moduleSpecifier) ||
          statement.moduleSpecifier.text !== "railway/iac" ||
          statement.importClause?.name ||
          statement.importClause?.isTypeOnly ||
          !statement.importClause?.namedBindings ||
          !ts.isNamedImports(statement.importClause.namedBindings)
        )
          return null;
        for (const binding of statement.importClause.namedBindings.elements) {
          if (
            binding.propertyName ||
            binding.isTypeOnly ||
            !["defineRailway", "project", "service"].includes(
              binding.name.text,
            ) ||
            imports.has(binding.name.text)
          )
            return null;
          imports.add(binding.name.text);
        }
      } else if (ts.isVariableStatement(statement)) {
        if (
          partial !== undefined ||
          statement.declarationList.flags !== ts.NodeFlags.Const ||
          statement.declarationList.declarations.length !== 1 ||
          statement.modifiers?.length !== 1 ||
          statement.modifiers[0]?.kind !== ts.SyntaxKind.ExportKeyword
        )
          return null;
        const declaration = statement.declarationList.declarations[0]!;
        if (
          !ts.isIdentifier(declaration.name) ||
          declaration.name.text !== "partial" ||
          !declaration.initializer
        )
          return null;
        partial = literal(declaration.initializer);
      } else if (ts.isExportAssignment(statement)) {
        const call = statement.expression;
        if (
          callback ||
          statement.isExportEquals ||
          !ts.isCallExpression(call) ||
          !ts.isIdentifier(call.expression) ||
          call.expression.text !== "defineRailway" ||
          call.arguments.length !== 1 ||
          !ts.isArrowFunction(call.arguments[0]!)
        )
          return null;
        callback = call.arguments[0] as ts.ArrowFunction;
      } else return null;
    }
    if (
      !sameAddresses(
        [...imports].map((v) => `service.${v}`),
        ["service.defineRailway", "service.project", "service.service"],
      ) ||
      partial !== FOURBROS_IAC_PARTIAL ||
      !callback ||
      callback.parameters.length !== 0 ||
      callback.modifiers?.length ||
      !ts.isBlock(callback.body) ||
      ![2, 3].includes(callback.body.statements.length)
    )
      return null;
    const statements = callback.body.statements;
    const create = statements[0];
    const returned = statements[statements.length - 1];
    if (
      !create ||
      !ts.isVariableStatement(create) ||
      create.declarationList.flags !== ts.NodeFlags.Const ||
      create.declarationList.declarations.length !== 1 ||
      !returned ||
      !ts.isReturnStatement(returned) ||
      !returned.expression
    )
      return null;
    const declaration = create.declarationList.declarations[0]!;
    const call = declaration.initializer;
    if (
      !ts.isIdentifier(declaration.name) ||
      imports.has(declaration.name.text) ||
      declaration.name.text === "partial" ||
      declaration.type !== undefined ||
      !call ||
      !ts.isCallExpression(call) ||
      !ts.isIdentifier(call.expression) ||
      call.expression.text !== "service" ||
      call.arguments.length !== 2 ||
      literal(call.arguments[0]!) !== FOURBROS_IAC_TARGET.serviceName
    )
      return null;
    const serviceConfig = literal(call.arguments[1]!);
    if (
      !record(serviceConfig) ||
      !Object.keys(serviceConfig).every((k) =>
        [
          "build",
          "start",
          "healthcheck",
          "healthcheckTimeout",
          "deploy",
          "replicas",
        ].includes(k),
      )
    )
      return null;
    const projectCall = returned.expression;
    if (
      !ts.isCallExpression(projectCall) ||
      !ts.isIdentifier(projectCall.expression) ||
      projectCall.expression.text !== "project" ||
      projectCall.arguments.length !== 2 ||
      literal(projectCall.arguments[0]!) !== FOURBROS_IAC_TARGET.projectName
    )
      return null;
    let projectArgument = projectCall.arguments[1]!;
    if (statements.length === 3) {
      const definition = statements[1]!;
      if (
        !ts.isVariableStatement(definition) ||
        definition.modifiers?.length ||
        definition.declarationList.flags !== ts.NodeFlags.Const ||
        definition.declarationList.declarations.length !== 1 ||
        !ts.isIdentifier(projectArgument)
      )
        return null;
      const binding = definition.declarationList.declarations[0]!;
      if (
        !ts.isIdentifier(binding.name) ||
        imports.has(binding.name.text) ||
        binding.name.text === declaration.name.text ||
        binding.name.text === "partial" ||
        binding.name.text !== projectArgument.text ||
        binding.type !== undefined ||
        !binding.initializer
      )
        return null;
      projectArgument = binding.initializer;
    }
    if (!ts.isObjectLiteralExpression(projectArgument)) return null;
    const projectObject = projectArgument;
    if (projectObject.properties.length !== 2) return null;
    let variables = false;
    let resources = false;
    for (const property of projectObject.properties) {
      if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name))
        return null;
      if (property.name.text === "variables" && !variables)
        variables = equal(literal(property.initializer), { managed: false });
      else if (
        property.name.text === "resources" &&
        !resources &&
        ts.isArrayLiteralExpression(property.initializer) &&
        property.initializer.elements.length === 1
      ) {
        const resource = property.initializer.elements[0]!;
        resources =
          ts.isIdentifier(resource) && resource.text === declaration.name.text;
      } else return null;
    }
    if (
      !variables ||
      !resources ||
      !record(serviceConfig.build) ||
      !Object.keys(serviceConfig.build).every((k) =>
        ["buildEnvironment", "builder", "dockerfilePath"].includes(k),
      ) ||
      serviceConfig.build.buildEnvironment !== "V3" ||
      !["RAILPACK", "DOCKERFILE"].includes(
        String(serviceConfig.build.builder),
      ) ||
      (serviceConfig.build.builder === "DOCKERFILE" &&
        serviceConfig.build.dockerfilePath !== "Dockerfile") ||
      (serviceConfig.build.builder === "RAILPACK" &&
        serviceConfig.build.dockerfilePath !== undefined) ||
      !equal(serviceConfig.replicas, { "us-west2": 1 })
    )
      return null;
    const deploy: RecordValue = record(serviceConfig.deploy)
      ? { ...serviceConfig.deploy }
      : {};
    if (serviceConfig.deploy !== undefined && !record(serviceConfig.deploy))
      return null;
    const allowedDeploy: RecordValue = {
      drainingSeconds: 30,
      overlapSeconds: 0,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 10,
    };
    if (
      !Object.entries(deploy).every(
        ([key, value]) =>
          Object.hasOwn(allowedDeploy, key) && value === allowedDeploy[key],
      )
    )
      return null;
    if (serviceConfig.start !== undefined) {
      if (
        !["pnpm server:start", "node --import tsx server/start.ts"].includes(
          String(serviceConfig.start),
        )
      )
        return null;
      deploy.startCommand = serviceConfig.start;
    }
    if (serviceConfig.healthcheck !== undefined) {
      if (!["/healthz", "/readyz"].includes(String(serviceConfig.healthcheck)))
        return null;
      deploy.healthcheckPath = serviceConfig.healthcheck;
    }
    if (serviceConfig.healthcheckTimeout !== undefined) {
      if (serviceConfig.healthcheckTimeout !== 60) return null;
      deploy.healthcheckTimeout = 60;
    }
    deploy.multiRegionConfig = { "us-west2": { numReplicas: 1 } };
    return { serviceConfig, build: serviceConfig.build, deploy };
  } catch {
    return null;
  }
}

const ROOT_KEYS = [
  "schemaVersion",
  "phase",
  "capturedAt",
  "cliEvidence",
  "target",
  "source",
  "inventory",
  "ownership",
  "ownershipObservedAt",
  "plan",
];
const CLI_KEYS = [
  "cliVersion",
  "capturedFromHelp",
  "nativeEngine",
  "planJsonSupported",
  "planOutSupported",
  "detailedExitCodeSupported",
  "sdkPackageVersion",
  "sdkSchemaSha256",
];
const SOURCE_KEYS = [
  "path",
  "sha256",
  "treeSha1",
  "generatedBy",
  "generatedSource",
  "generatedSourceSha256",
  "variablesMode",
  "generationLocalOnly",
  "decryptVariablesUsed",
  "omitPreservedVariablesUsed",
  "manualSecretReviewCompleted",
];
const INVENTORY_KEYS = [
  "observedAt",
  "projectId",
  "environmentId",
  "serviceId",
  "serviceName",
  "targetServiceAddress",
  "resourceAddresses",
  "targetMembershipEvidenceSha256",
  "configFileSetting",
];
const OWNERSHIP_KEYS = [
  "ok",
  "environmentId",
  "environmentName",
  "configEtag",
  "iacPartials",
  "wholeProjectAvailable",
];
const PLAN_KEYS = [
  "capturedAt",
  "sourceSha256",
  "pinnedText",
  "pinnedSha256",
  "outputText",
  "outputSha256",
  "storedOutsideRepository",
  "exitCode",
  "detailedExitCodeUsed",
  "showValuesUsed",
  "decryptVariablesUsed",
  "nativeEngine",
];
const PIN_KEYS = [
  "kind",
  "version",
  "cliVersion",
  "sourceTree",
  "environmentId",
  "configEtag",
  "changeSetHash",
  "changeSet",
  "diff",
  "destructive",
  "claim",
];
const OUTPUT_KEYS = [
  "ok",
  "command",
  "file",
  "currentEnvironment",
  "changeSet",
  "diff",
  "diagnostics",
  "currentGraph",
  "desiredGraph",
  "stagedPatch",
  "applyResult",
  "deploymentId",
  "stagedPatchId",
  "variablePolicy",
];
const RESOURCE_KEYS = [
  "address",
  "type",
  "kind",
  "name",
  "engine",
  "variables",
  "source",
  "build",
  "deploy",
  "networking",
  "volumeAttachments",
  "config",
  "groupId",
  "tracing",
  "cdn",
];
const CHANGE_KEYS = [
  "address",
  "after",
  "before",
  "deployEffect",
  "details",
  "field",
  "kind",
  "path",
  "severity",
  "summary",
];

function safeGraph(
  graph: unknown,
): graph is RecordValue & { resources: RecordValue[] } {
  return (
    exact(graph, ["project", "resources"]) &&
    exact(graph.project, ["name"]) &&
    graph.project.name === FOURBROS_IAC_TARGET.projectName &&
    Array.isArray(graph.resources) &&
    graph.resources.length > 0 &&
    graph.resources.length <= 100 &&
    graph.resources.every(
      (r) =>
        exact(r, RESOURCE_KEYS) &&
        (r.variables === null ||
          (record(r.variables) &&
            Object.values(r.variables).every((v) =>
              equal(v, { type: "preserve" }),
            ))),
    ) &&
    addresses(graph.resources.map((r) => r.address))
  );
}

export function validateNamedPartialEvidence(
  input: unknown,
  filesystem: NamedPartialFilesystem,
  legacyFixtureHash: string,
  sourceIsSecretSafe: (source: string) => boolean,
  nowMs = Date.now(),
) {
  const reasons = new Set<NamedPartialReason>();
  const finish = () => ({
    schemaVersion: 2 as const,
    migrationEvidence: reasons.size ? ("hold" as const) : ("pass" as const),
    authorizesMigration: false as const,
    authorizesApply: false as const,
    authorizesDeployment: false as const,
    externalMutationPerformed: false as const,
    reasons: [...reasons].sort(),
  });
  if (!Number.isFinite(nowMs) || nowMs < 0) reasons.add("clock-invalid");
  if (
    !exact(input, ROOT_KEYS) ||
    input.schemaVersion !== 2 ||
    !["ownership-parity", "runtime-update"].includes(String(input.phase))
  ) {
    reasons.add("invalid-schema");
    return finish();
  }
  if (!fresh(input.capturedAt, nowMs)) reasons.add("evidence-stale");
  if (!fresh(input.ownershipObservedAt, nowMs)) reasons.add("evidence-stale");
  if (!equal(input.target, FOURBROS_IAC_TARGET))
    reasons.add("target-identity-invalid");
  const cli = input.cliEvidence;
  if (
    !exact(cli, CLI_KEYS) ||
    !stableVersion(cli.cliVersion) ||
    cli.capturedFromHelp !== true ||
    cli.nativeEngine !== true ||
    cli.planJsonSupported !== true ||
    cli.planOutSupported !== true ||
    cli.detailedExitCodeSupported !== true
  )
    reasons.add("cli-capability-unverified");
  if (
    !record(cli) ||
    cli.sdkPackageVersion !== FOURBROS_IAC_SDK_VERSION ||
    filesystem.sdkPackageVersion !== FOURBROS_IAC_SDK_VERSION ||
    !hash(cli.sdkSchemaSha256) ||
    cli.sdkSchemaSha256 !== FOURBROS_IAC_SDK_SCHEMA_SHA256 ||
    cli.sdkSchemaSha256 !== filesystem.sdkSchemaSha256
  )
    reasons.add("sdk-schema-unverified");
  if (
    filesystem.legacyJsonFilePresent !== false ||
    filesystem.legacyTomlFilePresent !== false ||
    filesystem.currentRepositoryFilePresent !== false ||
    filesystem.currentRepositoryFileContent !== null ||
    filesystem.currentRepositoryFileSha256 !== null
  )
    reasons.add("alternate-legacy-config-present");
  if (
    !filesystem.legacyFixturePresent ||
    filesystem.legacyFixtureSha256 !== legacyFixtureHash ||
    typeof filesystem.legacyFixtureContent !== "string" ||
    iacSha256(filesystem.legacyFixtureContent) !== legacyFixtureHash
  )
    reasons.add("legacy-config-missing");
  const source = input.source;
  const sourceText = filesystem.generatedIacSource;
  const definition =
    typeof sourceText === "string"
      ? inspectNamedPartialSource(sourceText)
      : null;
  if (
    !exact(source, SOURCE_KEYS) ||
    source.path !== ".railway/railway.ts" ||
    filesystem.generatedIacPath !== source.path ||
    typeof sourceText !== "string" ||
    !definition ||
    source.sha256 !== filesystem.generatedIacSha256 ||
    source.sha256 !== iacSha256(sourceText) ||
    source.treeSha1 !== filesystem.generatedIacTreeSha1 ||
    source.treeSha1 !== singleFileIacTree(sourceText)
  )
    reasons.add("generated-iac-invalid");
  if (
    !record(source) ||
    source.generatedBy !==
      "railway config migrate --service four-bros-mahjong-online --variables unmanaged --apply" ||
    source.variablesMode !== "unmanaged" ||
    source.generationLocalOnly !== true ||
    typeof source.generatedSource !== "string" ||
    source.generatedSourceSha256 !== iacSha256(source.generatedSource) ||
    !inspectNamedPartialSource(source.generatedSource)
  )
    reasons.add("source-provenance-invalid");
  if (
    !record(source) ||
    filesystem.generatedIacSecretSafe !== true ||
    typeof sourceText !== "string" ||
    !sourceIsSecretSafe(sourceText) ||
    typeof source.generatedSource !== "string" ||
    !sourceIsSecretSafe(source.generatedSource) ||
    source.manualSecretReviewCompleted !== true ||
    source.decryptVariablesUsed !== false ||
    source.omitPreservedVariablesUsed !== false
  )
    reasons.add("secret-safety-unverified");
  const inventory = input.inventory;
  if (
    !exact(inventory, INVENTORY_KEYS) ||
    !fresh(inventory.observedAt, nowMs) ||
    inventory.projectId !== FOURBROS_IAC_TARGET.projectId ||
    inventory.environmentId !== FOURBROS_IAC_TARGET.environmentId ||
    inventory.serviceId !== FOURBROS_IAC_TARGET.serviceId ||
    inventory.serviceName !== FOURBROS_IAC_TARGET.serviceName ||
    inventory.targetServiceAddress !== FOURBROS_IAC_ADDRESS ||
    !hash(inventory.targetMembershipEvidenceSha256) ||
    !addresses(inventory.resourceAddresses) ||
    !inventory.resourceAddresses.includes(FOURBROS_IAC_ADDRESS)
  )
    reasons.add("resource-inventory-mismatch");
  // null leaves the Config File setting unspecified. The builder may still
  // discover a root railway.json; the CLI's cutover explicitly writes "".
  if (!record(inventory) || inventory.configFileSetting !== "")
    reasons.add("ownership-cutover-unverified");
  const ownership = input.ownership;
  if (
    !exact(ownership, OWNERSHIP_KEYS) ||
    ownership.ok !== true ||
    ownership.environmentId !== FOURBROS_IAC_TARGET.environmentId ||
    ownership.environmentName !== "production" ||
    !hash(ownership.configEtag) ||
    !record(ownership.iacPartials) ||
    typeof ownership.wholeProjectAvailable !== "boolean"
  )
    reasons.add("partial-ownership-invalid");
  else {
    for (const [address, owner] of Object.entries(ownership.iacPartials)) {
      if (
        !addresses([address]) ||
        typeof owner !== "string" ||
        !/^[A-Za-z0-9_.-]{1,64}$/.test(owner) ||
        !record(inventory) ||
        !Array.isArray(inventory.resourceAddresses) ||
        !inventory.resourceAddresses.includes(address) ||
        (address === FOURBROS_IAC_ADDRESS && owner !== FOURBROS_IAC_PARTIAL) ||
        (owner === FOURBROS_IAC_PARTIAL && address !== FOURBROS_IAC_ADDRESS)
      )
        reasons.add("partial-ownership-invalid");
    }
    if (
      ownership.wholeProjectAvailable !==
      (Object.keys(ownership.iacPartials).length === 0)
    )
      reasons.add("partial-ownership-invalid");
  }
  const plan = input.plan;
  if (
    !exact(plan, PLAN_KEYS) ||
    !fresh(plan.capturedAt, nowMs) ||
    !record(source) ||
    plan.sourceSha256 !== source.sha256 ||
    plan.storedOutsideRepository !== true ||
    plan.detailedExitCodeUsed !== true ||
    plan.nativeEngine !== true ||
    plan.showValuesUsed !== false ||
    plan.decryptVariablesUsed !== false ||
    typeof plan.pinnedText !== "string" ||
    typeof plan.outputText !== "string" ||
    Buffer.byteLength(plan.pinnedText) + Buffer.byteLength(plan.outputText) >
      60 * 1024 ||
    plan.pinnedSha256 !== iacSha256(plan.pinnedText) ||
    plan.outputSha256 !== iacSha256(plan.outputText)
  ) {
    reasons.add("pinned-plan-unverified");
    return finish();
  }
  if (
    !record(inventory) ||
    Date.parse(String(inventory.observedAt)) >
      Date.parse(String(plan.capturedAt)) ||
    Date.parse(String(input.ownershipObservedAt)) >
      Date.parse(String(plan.capturedAt)) ||
    Date.parse(String(plan.capturedAt)) > Date.parse(String(input.capturedAt))
  )
    reasons.add("evidence-stale");
  let pin: unknown;
  let output: unknown;
  try {
    pin = parseStrictJson(plan.pinnedText);
    output = parseStrictJson(plan.outputText);
  } catch {
    reasons.add("invalid-schema");
    return finish();
  }
  if (
    !exact(pin, PIN_KEYS) ||
    pin.kind !== "railway.config.plan" ||
    pin.version !== 1 ||
    !record(cli) ||
    pin.cliVersion !== cli.cliVersion ||
    pin.environmentId !== FOURBROS_IAC_TARGET.environmentId ||
    !record(ownership) ||
    pin.configEtag !== ownership.configEtag ||
    !record(source) ||
    pin.sourceTree !== source.treeSha1 ||
    pin.destructive !== false ||
    typeof pin.diff !== "string" ||
    typeof pin.claim !== "boolean" ||
    !exact(pin.changeSet, [
      "changes",
      "declared",
      "diagnostics",
      "partial",
      "telemetry",
      "version",
    ]) ||
    pin.changeSet.version !== 1 ||
    pin.changeSet.partial !== FOURBROS_IAC_PARTIAL ||
    !equal(pin.changeSet.declared, [FOURBROS_IAC_ADDRESS]) ||
    !equal(pin.changeSet.diagnostics, []) ||
    !equal(pin.changeSet.telemetry, { language: "typescript" }) ||
    pin.changeSetHash !==
      `sha256:${iacSha256(JSON.stringify(pin.changeSet))}` ||
    !Array.isArray(pin.changeSet.changes)
  ) {
    reasons.add("pinned-plan-unverified");
    return finish();
  }
  if (
    !exact(output, OUTPUT_KEYS) ||
    output.ok !== true ||
    output.command !== "plan" ||
    !authoringPath(output.file) ||
    output.diff !== pin.diff ||
    !exact(output.currentEnvironment, [
      "projectId",
      "projectName",
      "environmentId",
      "environmentName",
      "configEtag",
      "pr",
    ]) ||
    !Object.entries(FOURBROS_IAC_TARGET)
      .filter(([k]) => !k.startsWith("service"))
      .every(
        ([k, v]) =>
          record(output.currentEnvironment) &&
          output.currentEnvironment[k] === v,
      ) ||
    output.currentEnvironment.configEtag !== pin.configEtag ||
    output.currentEnvironment.pr !== null ||
    !equal(output.diagnostics, []) ||
    output.stagedPatch !== null ||
    output.applyResult !== null ||
    output.deploymentId !== null ||
    output.stagedPatchId !== null ||
    !equal(output.variablePolicy, {
      managed: false,
      ignore: [],
      default: false,
      ignoredCount: 0,
      byPattern: {},
    }) ||
    !safeGraph(output.currentGraph) ||
    !safeGraph(output.desiredGraph) ||
    !sameAddresses(
      output.currentGraph.resources.map((r) => r.address),
      record(inventory) ? inventory.resourceAddresses : null,
    ) ||
    !equal(
      output.desiredGraph.resources.map((r) => r.address),
      [FOURBROS_IAC_ADDRESS],
    )
  ) {
    reasons.add("native-plan-invalid");
    return finish();
  }
  const before = output.currentGraph.resources.find(
    (r) => r.address === FOURBROS_IAC_ADDRESS,
  );
  const after = output.desiredGraph.resources[0];
  if (
    !before ||
    !after ||
    before.type !== "service" ||
    before.name !== FOURBROS_IAC_TARGET.serviceName ||
    after.type !== "service" ||
    after.kind !== "empty" ||
    after.name !== FOURBROS_IAC_TARGET.serviceName ||
    !definition ||
    !equal(after.build, definition.build) ||
    !equal(after.deploy, definition.deploy) ||
    [
      "engine",
      "variables",
      "source",
      "networking",
      "volumeAttachments",
      "config",
      "groupId",
      "tracing",
      "cdn",
    ].some((key) => after[key] !== null)
  )
    reasons.add("generated-iac-invalid");
  const changes = pin.changeSet.changes;
  const fields = new Set<string>();
  for (const change of changes) {
    if (
      !exact(change, CHANGE_KEYS) ||
      change.address !== FOURBROS_IAC_ADDRESS ||
      change.kind !== "resource.update" ||
      change.severity !== "safe" ||
      change.deployEffect !== "deploy" ||
      !["build", "deploy"].includes(String(change.field)) ||
      change.path !== `resources.${FOURBROS_IAC_ADDRESS}.${change.field}` ||
      fields.has(String(change.field)) ||
      !before ||
      !after ||
      !equal(change.before, before[String(change.field)]) ||
      !equal(change.after, after[String(change.field)]) ||
      !Array.isArray(change.details) ||
      !change.details.every(
        (s) =>
          typeof s === "string" &&
          /^(?:build\.(?:builder|dockerfilePath|buildEnvironment)|deploy\.(?:drainingSeconds|overlapSeconds|restartPolicyType|restartPolicyMaxRetries|startCommand|healthcheckPath|healthcheckTimeout|multiRegionConfig))\s/.test(
            s,
          ),
      )
    )
      reasons.add("runtime-changes-outside-allowlist");
    if (record(change)) fields.add(String(change.field));
  }
  if (
    !before ||
    !after ||
    ["build", "deploy"].some(
      (field) => !equal(before[field], after[field]) && !fields.has(field),
    )
  )
    reasons.add("runtime-changes-outside-allowlist");
  if (
    !exact(output.changeSet, ["changes"]) ||
    !Array.isArray(output.changeSet.changes) ||
    !equal(
      output.changeSet.changes,
      changes.map((c) =>
        record(c)
          ? {
              summary: c.summary,
              severity: c.severity,
              kind: c.kind,
              details: c.details,
            }
          : null,
      ),
    )
  )
    reasons.add("native-plan-invalid");
  if (
    record(ownership.iacPartials) &&
    pin.claim !== (ownership.iacPartials[FOURBROS_IAC_ADDRESS] === undefined)
  )
    reasons.add("partial-ownership-invalid");
  if (input.phase === "ownership-parity") {
    if (changes.length !== 0 || plan.exitCode !== 0)
      reasons.add("parity-plan-not-clean");
  } else if (
    !definition ||
    !equal(definition.build, {
      buildEnvironment: "V3",
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile",
    }) ||
    !equal(definition.deploy, {
      drainingSeconds: 30,
      overlapSeconds: 0,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 10,
      startCommand: "node --import tsx server/start.ts",
      healthcheckPath: "/readyz",
      healthcheckTimeout: 60,
      multiRegionConfig: { "us-west2": { numReplicas: 1 } },
    }) ||
    plan.exitCode !== (changes.length > 0 ? 2 : 0)
  )
    reasons.add("runtime-changes-outside-allowlist");
  return finish();
}
