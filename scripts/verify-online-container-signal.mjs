import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import process from "node:process";
import { WebSocket } from "ws";

const TEST_ORIGIN = "http://container-signal.local";
const CONTAINER_PORT = 8080;
const COMMAND_TIMEOUT_MS = 15_000;
const START_TIMEOUT_MS = 15_000;
const STOP_MARGIN_MS = 1_500;
const PORT_PROBE_TIMEOUT_MS = 250;
const EXPECTED_CMDLINE = "node --import tsx server/start.ts";
const OWNERSHIP_LABEL = "com.fourbrosmahjong.signal-verifier-run";
const CONTAINER_MEMORY_LIMIT = "512m";
const CONTAINER_CPU_LIMIT = "1";
const CONTAINER_PIDS_LIMIT = "128";
const RUNTIME_TMPFS = "/tmp:rw,nosuid,nodev,size=64m";
const REQUIRED_RUNTIME_PACKAGES = ["tsx", "ws"];
const FORBIDDEN_RUNTIME_PACKAGES = [
  "vitest",
  "@playwright/test",
  "next",
  "playwright",
  "playwright-core",
  "react",
  "react-dom",
  "typescript",
];
const READ_ONLY_RUNTIME_PATHS = [
  "/app",
  "/app/node_modules",
  "/app/server",
  "/app/server/start.ts",
  "/app/src",
  "/app/src/domain",
  "/app/src/domain/game",
  "/app/src/domain/game/engine.ts",
];
const ABSENT_RUNTIME_PATHS = [
  "/app/.git",
  "/app/.github",
  "/app/scripts",
  "/app/e2e",
  "/app/docs",
  "/app/vitest.config.ts",
  "/app/src/test",
  "/app/server/index.lifecycle.test.ts",
  "/app/src/domain/hand/__oracle__",
  "/app/src/domain/game/__testing__",
  "/app/src/components/game/finishedGameFixture.ts",
];
const RUNTIME_SOURCE_SCAN_ROOTS = ["/app/server", "/app/src"];
const MAX_RUNTIME_SOURCE_ENTRIES = 10_000;
const MAX_RUNTIME_FILESYSTEM_ENTRIES = MAX_RUNTIME_SOURCE_ENTRIES;
const MAX_RUNTIME_SOURCE_DEPTH = 32;
const MAX_HEALTH_BODY_BYTES = 4_096;
const MAX_IMAGE_METADATA_BYTES = 16 * 1024;
const MAX_CONTAINER_METADATA_BYTES = 4 * 1024;
const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024;
const MAX_DOCKER_LOG_BYTES = 64 * 1024;
const MAX_TIMEOUT_DIAGNOSTIC_BYTES = 4 * 1024;
const PROCESS_OUTPUT_TRUNCATION_MARKER = Buffer.from(
  "\n...[process output truncated]",
  "utf8",
);
const MAX_UPGRADE_RESPONSE_BYTES = 16 * 1024;
const MAX_WEBSOCKET_MESSAGE_BYTES = 16 * 1024;
const CLOSED_PORT_ERROR_CODES = new Set(["ECONNREFUSED", "ECONNRESET"]);

const SENSITIVE_KEY_PATTERN =
  "(?:[A-Za-z0-9]+[_-])*" +
  "(?:token|secret|password|passwd|authorization|cookie|api[_-]?key|private[_-]?key)" +
  "(?:[_-][A-Za-z0-9]+)*";
const SENSITIVE_DIAGNOSTIC_PATTERN = new RegExp(
  `(["']?${SENSITIVE_KEY_PATTERN}["']?\\s*[:=]\\s*)("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^\\r\\n]*)`,
  "gi",
);
const BEARER_SECRET_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const PRIVATE_KEY_PATTERN =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const TOKEN_PREFIX_PATTERN =
  /\b(?:gh[pousr]_|github_pat_|xox[baprs]-|sk-[A-Za-z0-9_-]+|AIza[0-9A-Za-z_-])[A-Za-z0-9._~+/=-]*/gi;

function usage() {
  throw new Error(
    "usage: node scripts/verify-online-container-signal.mjs --image <local-image>",
  );
}

function parseArguments(argv) {
  let image = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== "--image" || image !== null) usage();
    const value = argv[index + 1];
    if (value === undefined || value.length === 0 || value.startsWith("--")) {
      usage();
    }
    image = value;
    index += 1;
  }
  if (image === null) usage();
  return Object.freeze({ image });
}

function createBoundedOutputCollector(
  maxBytes = MAX_PROCESS_OUTPUT_BYTES,
  retention = "head",
) {
  const chunks = [];
  let byteLength = 0;
  let truncated = false;

  if (retention !== "head" && retention !== "tail") {
    throw new Error(`unsupported output retention: ${retention}`);
  }

  return Object.freeze({
    append(chunk) {
      if (truncated && retention === "head") return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

      if (retention === "tail") {
        if (buffer.byteLength >= maxBytes) {
          chunks.splice(
            0,
            chunks.length,
            Buffer.from(buffer.subarray(buffer.byteLength - maxBytes)),
          );
          byteLength = maxBytes;
          truncated = true;
          return;
        }
        if (buffer.byteLength > 0) {
          chunks.push(Buffer.from(buffer));
          byteLength += buffer.byteLength;
        }
        while (byteLength > maxBytes) {
          const excess = byteLength - maxBytes;
          const first = chunks[0];
          if (first.byteLength <= excess) {
            chunks.shift();
            byteLength -= first.byteLength;
          } else {
            chunks[0] = first.subarray(excess);
            byteLength -= excess;
          }
        }
        if (buffer.byteLength > 0) truncated = true;
        return;
      }

      const remaining = maxBytes - byteLength;
      if (buffer.byteLength <= remaining) {
        if (buffer.byteLength > 0) {
          chunks.push(Buffer.from(buffer));
          byteLength += buffer.byteLength;
        }
        return;
      }

      truncated = true;
      const markerLength = PROCESS_OUTPUT_TRUNCATION_MARKER.byteLength;
      const contentLength = Math.max(0, remaining - markerLength);
      if (contentLength > 0) {
        chunks.push(Buffer.from(buffer.subarray(0, contentLength)));
        byteLength += contentLength;
      }
      if (byteLength + markerLength <= maxBytes) {
        chunks.push(PROCESS_OUTPUT_TRUNCATION_MARKER);
        byteLength += markerLength;
      }
    },
    text() {
      return Buffer.concat(chunks, byteLength).toString("utf8");
    },
  });
}

function sanitizeDiagnosticText(value) {
  const withoutControlSequences = String(value)
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(PRIVATE_KEY_PATTERN, "[redacted-private-key]")
    .replace(BEARER_SECRET_PATTERN, "$1 [redacted]")
    .replace(TOKEN_PREFIX_PATTERN, "[redacted-token]")
    .replace(SENSITIVE_DIAGNOSTIC_PATTERN, "$1[redacted]")
    .replace(/[^\t\n\r\x20-\x7e]/g, "?");
  const bytes = Buffer.from(withoutControlSequences, "utf8");
  if (bytes.byteLength <= MAX_TIMEOUT_DIAGNOSTIC_BYTES) {
    return withoutControlSequences;
  }
  const marker = "\n...[diagnostic truncated]";
  const contentLength = Math.max(
    0,
    MAX_TIMEOUT_DIAGNOSTIC_BYTES - Buffer.byteLength(marker),
  );
  return `${bytes.subarray(0, contentLength).toString("utf8")}${marker}`;
}

function safeCommandArguments(args) {
  return sanitizeDiagnosticText(args.join(" "));
}

function diagnosticSuffix(label, value) {
  const text = sanitizeDiagnosticText(value);
  return text.length > 0 ? `\n${label}:\n${text}` : "";
}

function boundedTimeoutMs(timeoutMs, label) {
  const value = Math.floor(Number(timeoutMs));
  invariant(
    Number.isFinite(value) && value > 0,
    `${label} deadline has expired`,
  );
  return value;
}

function run(command, args, options = {}) {
  const timeoutMs = boundedTimeoutMs(
    options.timeoutMs ?? COMMAND_TIMEOUT_MS,
    `${command} command`,
  );
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const outputMaxBytes = options.outputMaxBytes ?? MAX_PROCESS_OUTPUT_BYTES;
    const outputRetention = options.outputRetention ?? "head";
    const captureIndividualOutput = options.captureIndividualOutput !== false;
    const stdout = captureIndividualOutput
      ? createBoundedOutputCollector(outputMaxBytes, outputRetention)
      : null;
    const stderr = captureIndividualOutput
      ? createBoundedOutputCollector(outputMaxBytes, outputRetention)
      : null;
    const combinedOutput =
      options.combinedOutputMaxBytes === undefined
        ? null
        : createBoundedOutputCollector(
            options.combinedOutputMaxBytes,
            options.outputRetention ?? "tail",
          );
    let settled = false;
    let timedOut = false;
    const timeoutError = () =>
      new Error(
        `${command} timed out after ${timeoutMs}ms: ${safeCommandArguments(args)}` +
          diagnosticSuffix("stderr", stderr?.text() ?? ""),
      );
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout?.append(chunk);
      combinedOutput?.append(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr?.append(chunk);
      combinedOutput?.append(chunk);
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        timedOut
          ? timeoutError()
          : new Error(`${command} failed to start: ${error.code ?? "unknown"}`),
      );
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const result = Object.freeze({
        code,
        signal,
        stdout: stdout?.text() ?? "",
        stderr: stderr?.text() ?? "",
        combined: combinedOutput?.text(),
      });
      if (timedOut) {
        reject(timeoutError());
        return;
      }
      if (code === 0 || options.allowFailure === true) resolve(result);
      else {
        reject(
          new Error(
            `${command} ${safeCommandArguments(args)} failed (${code ?? signal})` +
              diagnosticSuffix("stderr", result.stderr),
          ),
        );
      }
    });
  });
}

async function docker(args, options) {
  return run("docker", args, options);
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function withTimeout(promise, timeoutMs, label) {
  const boundedMs = boundedTimeoutMs(timeoutMs, label);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${boundedMs}ms`)),
      boundedMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function waitUntil(probe, timeoutMs, label) {
  const boundedMs = boundedTimeoutMs(timeoutMs, label);
  const deadline = Date.now() + boundedMs;
  let lastError = null;
  while (Date.now() < deadline) {
    const remainingMs = deadline - Date.now();
    try {
      const value = await withTimeout(
        Promise.resolve().then(() => probe(remainingMs)),
        remainingMs,
        `${label} probe`,
      );
      if (value !== null && value !== false) return value;
    } catch (error) {
      lastError = error;
    }
    const delayMs = Math.min(50, deadline - Date.now());
    if (delayMs > 0) await delay(delayMs);
  }
  throw new Error(
    `${label} timed out after ${boundedMs}ms${
      lastError instanceof Error
        ? `: ${sanitizeDiagnosticText(lastError.message)}`
        : ""
    }`,
  );
}

function remainingUntil(deadline, label) {
  return boundedTimeoutMs(deadline - Date.now(), label);
}

function parseBoundedJsonFields(output, expectedCount, label) {
  const fields = output.trim().split("\t");
  if (fields.length !== expectedCount) {
    throw new Error(`${label} metadata is invalid`);
  }
  try {
    return fields.map((field) => JSON.parse(field));
  } catch {
    throw new Error(`${label} metadata is invalid`);
  }
}

const CONTAINER_STATE_FORMAT =
  "{{json .State.Running}}\t{{json .State.ExitCode}}\t{{json .State.OOMKilled}}\t{{json .State.Pid}}";
const CONTAINER_IDENTITY_FORMAT =
  `{{with index .Config.Labels "${OWNERSHIP_LABEL}"}}{{json .}}{{else}}null{{end}}\t{{json .State.Running}}`;

async function containerState(name, timeoutMs = COMMAND_TIMEOUT_MS) {
  const result = await docker(
    ["inspect", name, "--format", CONTAINER_STATE_FORMAT],
    {
      timeoutMs,
      outputMaxBytes: MAX_CONTAINER_METADATA_BYTES,
    },
  );
  const [running, exitCode, oomKilled, pid] = parseBoundedJsonFields(
    result.stdout,
    4,
    "container state",
  );
  invariant(
    typeof running === "boolean" &&
      Number.isSafeInteger(exitCode) &&
      typeof oomKilled === "boolean" &&
      Number.isSafeInteger(pid),
    "container state metadata is invalid",
  );
  return { Running: running, ExitCode: exitCode, OOMKilled: oomKilled, Pid: pid };
}

async function waitForStopped(name, timeoutMs) {
  return waitUntil(
    async (remainingMs) => {
      const state = await containerState(name, remainingMs);
      return state.Running === false ? state : null;
    },
    timeoutMs,
    `${name} stop`,
  );
}

async function hostPort(name, timeoutMs = COMMAND_TIMEOUT_MS) {
  const result = await docker(["port", name, `${CONTAINER_PORT}/tcp`], {
    timeoutMs,
    outputMaxBytes: MAX_CONTAINER_METADATA_BYTES,
  });
  const match = result.stdout.trim().match(/127\.0\.0\.1:(\d+)$/);
  if (match === null) throw new Error("unexpected docker port response");
  return Number(match[1]);
}

function declaredContentLength(response) {
  const value = response.headers.get("content-length");
  if (value === null) return undefined;
  if (!/^\d+$/.test(value)) throw new Error("invalid response body length");
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    throw new Error("invalid response body length");
  }
  return length;
}

async function cancelResponseBody(response) {
  if (response.body === null) return;
  try {
    await response.body.cancel();
  } catch {
    // The bounded-body result is more useful than a cancellation error.
  }
}

async function cancelResponseReader(reader) {
  try {
    await reader.cancel();
  } catch {
    // The bounded-body result is more useful than a cancellation error.
  }
}

async function readBoundedResponseBody(response) {
  let expectedLength;
  try {
    expectedLength = declaredContentLength(response);
  } catch (error) {
    await cancelResponseBody(response);
    throw error;
  }
  if (expectedLength !== undefined && expectedLength > MAX_HEALTH_BODY_BYTES) {
    await cancelResponseBody(response);
    throw new Error("response body too large");
  }

  if (response.body === null) {
    if (expectedLength !== undefined && expectedLength !== 0) {
      throw new Error("truncated response body");
    }
    return new Uint8Array();
  }

  let reader;
  try {
    reader = response.body.getReader();
  } catch (error) {
    await cancelResponseBody(response);
    throw error;
  }
  const chunks = [];
  let receivedBytes = 0;
  let bodyConsumed = false;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        bodyConsumed = true;
        break;
      }
      if (!(result.value instanceof Uint8Array)) {
        throw new Error("invalid response body");
      }
      receivedBytes += result.value.byteLength;
      if (receivedBytes > MAX_HEALTH_BODY_BYTES) {
        throw new Error("response body too large");
      }
      chunks.push(result.value);
    }
  } finally {
    if (!bodyConsumed) await cancelResponseReader(reader);
    reader.releaseLock();
  }

  if (expectedLength !== undefined && receivedBytes !== expectedLength) {
    throw new Error(
      receivedBytes < expectedLength
        ? "truncated response body"
        : "invalid response body length",
    );
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function parseJsonWithUniqueKeys(text) {
  const cursor = { index: 0 };

  function skipWhitespace() {
    while (/[\t\n\r ]/.test(text[cursor.index] ?? "")) {
      cursor.index += 1;
    }
  }

  function scanString() {
    const start = cursor.index;
    if (text[cursor.index] !== '"') {
      throw new Error("JSON string expected");
    }
    cursor.index += 1;
    while (cursor.index < text.length) {
      const code = text.charCodeAt(cursor.index);
      if (code === 0x22) {
        cursor.index += 1;
        return JSON.parse(text.slice(start, cursor.index));
      }
      if (code === 0x5c) {
        cursor.index += 1;
        if (cursor.index >= text.length) throw new Error("invalid JSON escape");
        if (text[cursor.index] === "u") cursor.index += 5;
        else cursor.index += 1;
        continue;
      }
      if (code < 0x20) throw new Error("invalid JSON string");
      cursor.index += 1;
    }
    throw new Error("unterminated JSON string");
  }

  function scanPrimitive() {
    const start = cursor.index;
    while (
      cursor.index < text.length &&
      !/[\t\n\r ,\]}]/.test(text[cursor.index])
    ) {
      cursor.index += 1;
    }
    if (cursor.index === start) throw new Error("JSON value expected");
  }

  function scanValue() {
    skipWhitespace();
    const character = text[cursor.index];
    if (character === "{") return scanObject();
    if (character === "[") return scanArray();
    if (character === '"') {
      scanString();
      return;
    }
    scanPrimitive();
  }

  function scanObject() {
    cursor.index += 1;
    skipWhitespace();
    const keys = new Set();
    if (text[cursor.index] === "}") {
      cursor.index += 1;
      return;
    }
    while (true) {
      skipWhitespace();
      const key = scanString();
      if (keys.has(key)) throw new Error(`duplicate JSON object key: ${key}`);
      keys.add(key);
      skipWhitespace();
      if (text[cursor.index] !== ":") throw new Error("JSON colon expected");
      cursor.index += 1;
      scanValue();
      skipWhitespace();
      if (text[cursor.index] === "}") {
        cursor.index += 1;
        return;
      }
      if (text[cursor.index] !== ",") throw new Error("JSON comma expected");
      cursor.index += 1;
    }
  }

  function scanArray() {
    cursor.index += 1;
    skipWhitespace();
    if (text[cursor.index] === "]") {
      cursor.index += 1;
      return;
    }
    while (true) {
      scanValue();
      skipWhitespace();
      if (text[cursor.index] === "]") {
        cursor.index += 1;
        return;
      }
      if (text[cursor.index] !== ",") throw new Error("JSON comma expected");
      cursor.index += 1;
    }
  }

  scanValue();
  skipWhitespace();
  if (cursor.index !== text.length) throw new Error("trailing JSON data");
  return JSON.parse(text);
}

function isExactHealthBody(bytes, path) {
  let value;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = parseJsonWithUniqueKeys(text);
  } catch {
    return false;
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  if (path === "/healthz") {
    const keys = Object.keys(value);
    return (
      keys.length === 2 &&
      keys.includes("ok") &&
      keys.includes("service") &&
      value.ok === true &&
      value.service === "four-bros-mahjong-online"
    );
  }

  if (path === "/readyz") {
    const keys = Object.keys(value);
    return keys.length === 1 && keys[0] === "ok" && value.ok === true;
  }

  return false;
}

async function waitForEndpoint(port, path, label) {
  return waitUntil(
    async (remainingMs) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        redirect: "manual",
        signal: AbortSignal.timeout(Math.max(1, Math.min(500, remainingMs))),
      });
      if (response.status !== 200) {
        await cancelResponseBody(response);
        return null;
      }
      const body = await readBoundedResponseBody(response);
      return isExactHealthBody(body, path) ? true : null;
    },
    START_TIMEOUT_MS,
    label,
  );
}

async function waitForHealth(port) {
  await waitForEndpoint(port, "/healthz", "container liveness");
  await waitForEndpoint(port, "/readyz", "container readiness");
}

function errorCode(error) {
  const visited = new Set();
  let current = error;
  while (
    current !== null &&
    typeof current === "object" &&
    !visited.has(current)
  ) {
    visited.add(current);
    if (typeof current.code === "string") return current.code;
    current = current.cause;
  }
  return undefined;
}

function probePortClosed(port, timeoutMs = PORT_PROBE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    let connected = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      callback(value);
    };

    socket.setTimeout(Math.max(1, Math.min(PORT_PROBE_TIMEOUT_MS, timeoutMs)), () => {
      finish(
        reject,
        new Error(`port ${port} close probe timed out; closure is unverified`),
      );
    });
    socket.once("connect", () => {
      connected = true;
      finish(resolve, false);
    });
    socket.once("error", (error) => {
      if (settled) return;
      if (!connected && CLOSED_PORT_ERROR_CODES.has(errorCode(error))) {
        finish(resolve, true);
        return;
      }
      finish(reject, error);
    });
    socket.once("close", () => {
      if (settled) return;
      finish(
        reject,
        new Error(`port ${port} closed without a refusal/reset error`),
      );
    });
  });
}

async function assertPortClosed(port, timeoutMs = STOP_MARGIN_MS) {
  await waitUntil(
    async (remainingMs) => {
      const closed = await probePortClosed(port, remainingMs);
      return closed ? true : null;
    },
    timeoutMs,
    "published port close",
  );
}

function assertExplicitNonRootImageUser(value) {
  invariant(
    typeof value === "string" && value.trim().length > 0,
    "image Config.User must explicitly name a non-root user",
  );
  const imageUser = value.trim();
  const [user] = imageUser.split(":", 1);
  const isNumericRoot = /^\d+$/.test(user) && Number(user) === 0;
  invariant(
    user.length > 0 && user.toLowerCase() !== "root" && !isNumericRoot,
    `image Config.User must be non-root: ${imageUser}`,
  );
  return imageUser;
}

function runtimeSecurityProbeSource() {
  return `
import { constants } from "node:fs";
import { access, opendir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const requiredPackages = ${JSON.stringify(REQUIRED_RUNTIME_PACKAGES)};
const forbiddenPackages = ${JSON.stringify(FORBIDDEN_RUNTIME_PACKAGES)};
const readOnlyPaths = ${JSON.stringify(READ_ONLY_RUNTIME_PATHS)};
const absentPaths = ${JSON.stringify(ABSENT_RUNTIME_PATHS)};
const sourceScanRoots = ${JSON.stringify(RUNTIME_SOURCE_SCAN_ROOTS)};
const maxRuntimeFilesystemEntries = ${MAX_RUNTIME_FILESYSTEM_ENTRIES};
const maxSourceDepth = ${MAX_RUNTIME_SOURCE_DEPTH};

async function forEachDirectoryEntry(path, onEntry) {
  const directory = await opendir(path);
  try {
    while (true) {
      const entry = await directory.read();
      if (entry === null) return;
      const shouldContinue = await onEntry(entry);
      if (shouldContinue === false) return;
    }
  } finally {
    await directory.close();
  }
}

let runtimeFilesystemEntries = 0;
function accountRuntimeEntry() {
  runtimeFilesystemEntries += 1;
  if (runtimeFilesystemEntries > maxRuntimeFilesystemEntries) {
    throw new Error("runtime filesystem scan exceeded entry limit");
  }
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function directPackageExists(packageName) {
  return pathExists(join("/app/node_modules", packageName, "package.json"));
}

async function scanPnpmStore(packageNames) {
  const prefixes = Object.fromEntries(
    packageNames.map((packageName) => [
      packageName,
      packageName.startsWith("@")
        ? packageName.replace("/", "+") + "@"
        : packageName + "@",
    ]),
  );
  const found = Object.fromEntries(
    packageNames.map((packageName) => [packageName, false]),
  );
  let foundCount = 0;
  await forEachDirectoryEntry("/app/node_modules/.pnpm", async (entry) => {
    accountRuntimeEntry();
    for (const packageName of packageNames) {
      if (!found[packageName] && entry.name.startsWith(prefixes[packageName])) {
        found[packageName] = true;
        foundCount += 1;
      }
    }
    return foundCount < packageNames.length;
  });
  return found;
}

function isTestOnlySource(path, entry) {
  return (
    entry.isSymbolicLink() ||
    (entry.isDirectory() &&
      (entry.name === "__oracle__" || entry.name === "__testing__")) ||
    (entry.isFile() &&
      (entry.name.includes(".test.") ||
        entry.name.includes(".spec.") ||
        path.endsWith("/finishedGameFixture.ts")))
  );
}

async function findUnexpectedSourceEntries(roots) {
  const pending = roots.map((path) => ({ depth: 0, path }));
  const unexpected = [];
  while (pending.length > 0) {
    const current = pending.pop();
    await forEachDirectoryEntry(current.path, async (entry) => {
      accountRuntimeEntry();
      const path = join(current.path, entry.name);
      if (isTestOnlySource(path, entry)) {
        unexpected.push(path);
        return true;
      }
      if (!entry.isDirectory()) return true;
      if (current.depth >= maxSourceDepth) {
        throw new Error("runtime source scan exceeded depth limit");
      }
      pending.push({ depth: current.depth + 1, path });
      return true;
    });
  }
  return unexpected.sort();
}

const status = await readFile("/proc/1/status", "utf8");
function processIds(label) {
  const match = status.match(
    new RegExp(
      "^" + label + ":\\\\s+(\\\\d+)\\\\s+(\\\\d+)\\\\s+(\\\\d+)\\\\s+(\\\\d+)",
      "m",
    ),
  );
  if (match === null) throw new Error("PID 1 " + label + " is unavailable");
  return match.slice(1).map(Number);
}

const required = Object.fromEntries(
  await Promise.all(
    requiredPackages.map(async (name) => [
      name,
      await directPackageExists(name),
    ]),
  ),
);
const forbiddenPnpmStore = await scanPnpmStore(forbiddenPackages);
const forbidden = Object.fromEntries(
  await Promise.all(
    forbiddenPackages.map(async (name) => [
      name,
      {
        direct: await directPackageExists(name),
        pnpmStore: forbiddenPnpmStore[name] === true,
      },
    ]),
  ),
);
const readOnlyRuntimePaths = Object.fromEntries(
  await Promise.all(
    readOnlyPaths.map(async (path) => {
      const metadata = await stat(path);
      await access(
        path,
        metadata.isDirectory() ? constants.R_OK | constants.X_OK : constants.R_OK,
      );
      let writable = true;
      try {
        await access(path, constants.W_OK);
      } catch (error) {
        if (error?.code !== "EACCES" && error?.code !== "EROFS") throw error;
        writable = false;
      }
      return [path, { uid: metadata.uid, gid: metadata.gid, writable }];
    }),
  ),
);
const unexpectedRuntimePaths = Object.fromEntries(
  await Promise.all(
    absentPaths.map(async (path) => [path, await pathExists(path)]),
  ),
);
const unexpectedRuntimeSourceEntries = await findUnexpectedSourceEntries(
  sourceScanRoots,
);
console.log(JSON.stringify({
  pid1Uids: processIds("Uid"),
  pid1Gids: processIds("Gid"),
  required,
  forbidden,
  readOnlyRuntimePaths,
  unexpectedRuntimePaths,
  unexpectedRuntimeSourceEntries,
}));
`;
}

async function inspectRuntimeSecurity(name) {
  const result = await docker([
    "exec",
    name,
    "node",
    "--input-type=module",
    "--eval",
    runtimeSecurityProbeSource(),
  ]);
  const details = JSON.parse(result.stdout.trim());
  invariant(
    Array.isArray(details.pid1Uids) &&
      details.pid1Uids.length === 4 &&
      details.pid1Uids.every(
        (value) => Number.isSafeInteger(value) && value > 0,
      ),
    `all PID 1 UIDs must be non-root: ${sanitizeDiagnosticText(
      JSON.stringify(details.pid1Uids),
    )}`,
  );
  invariant(
    Array.isArray(details.pid1Gids) &&
      details.pid1Gids.length === 4 &&
      details.pid1Gids.every(
        (value) => Number.isSafeInteger(value) && value > 0,
      ),
    `all PID 1 GIDs must be non-root: ${sanitizeDiagnosticText(
      JSON.stringify(details.pid1Gids),
    )}`,
  );
  for (const packageName of REQUIRED_RUNTIME_PACKAGES) {
    invariant(
      details.required?.[packageName] === true,
      `required runtime package is missing: ${packageName}`,
    );
  }
  for (const packageName of FORBIDDEN_RUNTIME_PACKAGES) {
    invariant(
      details.forbidden?.[packageName]?.direct === false &&
        details.forbidden?.[packageName]?.pnpmStore === false,
      `development-only package is present: ${packageName}`,
    );
  }
  for (const path of READ_ONLY_RUNTIME_PATHS) {
    const source = details.readOnlyRuntimePaths?.[path];
    invariant(
      source?.uid === 0 && source?.gid === 0,
      `runtime path must remain root-owned: ${path}`,
    );
    invariant(
      source.writable === false,
      `runtime path must not be writable: ${path}`,
    );
  }
  for (const path of ABSENT_RUNTIME_PATHS) {
    invariant(
      details.unexpectedRuntimePaths?.[path] === false,
      `unnecessary runtime path is present: ${path}`,
    );
  }
  invariant(
    Array.isArray(details.unexpectedRuntimeSourceEntries) &&
      details.unexpectedRuntimeSourceEntries.length === 0,
    `test-only runtime source is present: ${sanitizeDiagnosticText(
      JSON.stringify(details.unexpectedRuntimeSourceEntries),
    )}`,
  );
  return Object.freeze(details);
}

async function inspectProcessTree(name) {
  const [cmdlineResult, executableResult, topResult, runtimeSecurity] =
    await Promise.all([
      docker(["exec", name, "sh", "-c", 'tr "\\0" " " < /proc/1/cmdline']),
      docker(["exec", name, "readlink", "-f", "/proc/1/exe"]),
      docker(["top", name, "-eo", "pid,ppid,stat,comm,args"]),
      inspectRuntimeSecurity(name),
    ]);
  const cmdline = cmdlineResult.stdout.trim();
  const executable = executableResult.stdout.trim();
  const top = topResult.stdout.trim();
  invariant(
    cmdline === EXPECTED_CMDLINE,
    `unexpected PID 1: ${sanitizeDiagnosticText(cmdline)}`,
  );
  invariant(
    executable.endsWith("/node"),
    `PID 1 is not Node: ${sanitizeDiagnosticText(executable)}`,
  );
  invariant(
    top.includes(EXPECTED_CMDLINE),
    "docker top does not contain Node entrypoint",
  );
  for (const forbidden of ["/pnpm ", "sh -c tsx", "tsx/dist/cli.mjs"]) {
    invariant(
      !top.includes(forbidden),
      `unexpected process wrapper: ${forbidden}`,
    );
  }
  return Object.freeze({
    cmdline,
    executable,
    esbuildChildObserved: top.includes("/esbuild "),
    runtimeSecurity,
    top: sanitizeDiagnosticText(top),
  });
}

async function runContainer(
  image,
  scenario,
  shutdownGraceMs,
  socketCloseGraceMs,
) {
  const runId = randomUUID();
  const name = `fourbros-signal-${scenario}-${runId}`;
  try {
    await docker([
      "run",
      "--detach",
      "--read-only",
      "--tmpfs",
      RUNTIME_TMPFS,
      "--memory",
      CONTAINER_MEMORY_LIMIT,
      "--cpus",
      CONTAINER_CPU_LIMIT,
      "--pids-limit",
      CONTAINER_PIDS_LIMIT,
      "--cap-drop",
      "ALL",
      "--name",
      name,
      "--label",
      `${OWNERSHIP_LABEL}=${runId}`,
      "--env",
      `PORT=${CONTAINER_PORT}`,
      "--env",
      `ALLOWED_ORIGINS=${TEST_ORIGIN}`,
      "--env",
      "ONLINE_OPS_REQUIRED=false",
      "--env",
      "ONLINE_OPS_TOKEN=",
      "--env",
      "ONLINE_SOURCE_REVISION=",
      "--env",
      "ONLINE_MAINTENANCE_NOTICES_ENABLED=true",
      "--env",
      `ONLINE_SHUTDOWN_GRACE_MS=${shutdownGraceMs}`,
      "--env",
      `ONLINE_SOCKET_CLOSE_GRACE_MS=${socketCloseGraceMs}`,
      "--publish",
      `127.0.0.1::${CONTAINER_PORT}`,
      image,
    ]);
    const port = await hostPort(name);
    await waitForHealth(port);
    const processTree = await inspectProcessTree(name);
    return { name, port, processTree, runId };
  } catch (error) {
    await cleanupContainer(name, runId, { waitForAppearance: true });
    throw error;
  }
}

async function inspectContainerIdentity(name, timeoutMs) {
  const result = await docker(
    ["inspect", name, "--format", CONTAINER_IDENTITY_FORMAT],
    {
      allowFailure: true,
      timeoutMs,
      outputMaxBytes: MAX_CONTAINER_METADATA_BYTES,
    },
  );
  if (result.code !== 0) return null;
  const [label, running] = parseBoundedJsonFields(
    result.stdout,
    2,
    "container identity",
  );
  invariant(
    (label === null || typeof label === "string") &&
      typeof running === "boolean",
    "container identity metadata is invalid",
  );
  return { label, running };
}

async function cleanupContainer(name, runId, options = {}) {
  const timeoutMs = options.timeoutMs ?? STOP_MARGIN_MS;
  const deadline = Date.now() + boundedTimeoutMs(timeoutMs, "container cleanup");
  let identity = null;
  while (identity === null) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      if (options.waitForAppearance !== true) return;
      throw new Error(`container cleanup deadline exceeded while locating ${name}`);
    }
    identity = await inspectContainerIdentity(name, remainingMs);
    if (identity !== null || options.waitForAppearance !== true) return;
    await delay(Math.min(50, deadline - Date.now()));
  }
  if (identity.label !== runId) return;

  let remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    throw new Error(`container cleanup deadline exceeded for ${name}`);
  }
  if (identity.running === true) {
    await docker(["kill", "--signal=KILL", name], {
      allowFailure: true,
      timeoutMs: remainingMs,
      outputMaxBytes: MAX_CONTAINER_METADATA_BYTES,
    });
  }
  remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    throw new Error(`container cleanup deadline exceeded before removing ${name}`);
  }
  await docker(["rm", "--force", name], {
    allowFailure: true,
    timeoutMs: remainingMs,
    outputMaxBytes: MAX_CONTAINER_METADATA_BYTES,
  });
  remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    throw new Error(`container cleanup deadline exceeded while verifying ${name}`);
  }
  await waitUntil(
    async (probeRemainingMs) => {
      const current = await inspectContainerIdentity(name, probeRemainingMs);
      if (current === null) return true;
      if (current.label !== runId) {
        throw new Error(`container ownership changed during cleanup: ${name}`);
      }
      return null;
    },
    remainingMs,
    `${name} removal`,
  );
}

function eventRecords(logs) {
  const records = [];
  for (const line of logs.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const value = JSON.parse(trimmed);
      if (value !== null && typeof value === "object") records.push(value);
    } catch {
      // Non-JSON runtime output is ignored; lifecycle evidence is fixed JSON.
    }
  }
  return records;
}

function eventCount(records, event) {
  return records.filter((record) => record.event === event).length;
}

function assertCommonEvents(records, expectedSignalCount = 1) {
  invariant(
    eventCount(records, "shutdown-started") === 1,
    "shutdown must start exactly once",
  );
  invariant(
    eventCount(records, "shutdown-close-started") === 1,
    "socket close must start exactly once",
  );
  invariant(
    eventCount(records, "shutdown-completed") === 1,
    "shutdown must complete exactly once",
  );
  invariant(
    eventCount(records, "shutdown-cleanup-failed") === 0,
    "shutdown cleanup failed",
  );
  const signals = records.filter(
    (record) => record.event === "shutdown-signal-received",
  );
  invariant(
    signals.length === expectedSignalCount,
    `expected ${expectedSignalCount} signal receipt(s), got ${signals.length}`,
  );
  const firstSignal = signals[0];
  invariant(firstSignal?.signal === "SIGTERM", "first signal must be SIGTERM");
  invariant(firstSignal?.ordinal === 1, "first signal ordinal must be one");
}

async function logsFor(name, timeoutMs = COMMAND_TIMEOUT_MS) {
  const result = await docker(["logs", name], {
    allowFailure: true,
    captureIndividualOutput: false,
    combinedOutputMaxBytes: MAX_DOCKER_LOG_BYTES,
    timeoutMs,
    outputRetention: "tail",
  });
  return result.combined ?? "";
}

async function waitForLogEvent(name, event, timeoutMs = START_TIMEOUT_MS) {
  return waitUntil(
    async (remainingMs) => {
      const records = eventRecords(await logsFor(name, remainingMs));
      return records.some((record) => record.event === event) ? records : null;
    },
    timeoutMs,
    `${name} ${event}`,
  );
}

function websocketMessageText(data) {
  let bytes;
  let toText;
  if (Buffer.isBuffer(data)) {
    bytes = data.byteLength;
    toText = () => data.toString("utf8");
  } else if (data instanceof ArrayBuffer) {
    bytes = data.byteLength;
    toText = () => Buffer.from(data).toString("utf8");
  } else if (Array.isArray(data)) {
    bytes = 0;
    for (const chunk of data) {
      if (!Buffer.isBuffer(chunk)) {
        throw new Error("WebSocket message data is invalid");
      }
      bytes += chunk.byteLength;
      if (bytes > MAX_WEBSOCKET_MESSAGE_BYTES) {
        throw new Error(
          `WebSocket message exceeded ${MAX_WEBSOCKET_MESSAGE_BYTES} bytes`,
        );
      }
    }
    toText = () => Buffer.concat(data, bytes).toString("utf8");
  } else {
    const text = String(data);
    bytes = Buffer.byteLength(text, "utf8");
    toText = () => text;
  }
  if (bytes > MAX_WEBSOCKET_MESSAGE_BYTES) {
    throw new Error(
      `WebSocket message exceeded ${MAX_WEBSOCKET_MESSAGE_BYTES} bytes`,
    );
  }
  return toText();
}

function openWebSocket(port) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    origin: TEST_ORIGIN,
    maxPayload: MAX_WEBSOCKET_MESSAGE_BYTES,
  });
  const opened = new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const maintenance = new Promise((resolve, reject) => {
    socket.on("message", (data) => {
      try {
        const message = JSON.parse(websocketMessageText(data));
        if (message.type === "maintenance" && message.phase === "terminating") {
          resolve(message);
        }
      } catch (error) {
        reject(error);
        socket.terminate();
      }
    });
  });
  const closed = new Promise((resolve, reject) => {
    socket.once("close", (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });
    socket.once("error", reject);
  });
  return { socket, opened, maintenance, closed };
}

function openUncooperativeWebSocket(port) {
  const socket = createConnection({ host: "127.0.0.1", port });
  const closed = new Promise((resolve) => socket.once("close", resolve));
  const opened = new Promise((resolve, reject) => {
    const response = Buffer.allocUnsafe(MAX_UPGRADE_RESPONSE_BYTES);
    let responseLength = 0;
    let settled = false;
    let onData;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      socket.off("data", onData);
      socket.destroy();
      reject(error);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      socket.off("data", onData);
      socket.pause();
      resolve();
    };
    const responseText = () =>
      response.subarray(0, responseLength).toString("latin1");
    onData = (chunk) => {
      if (settled) return;
      for (const byte of chunk) {
        if (responseLength >= MAX_UPGRADE_RESPONSE_BYTES) {
          fail(
            new Error(
              `WebSocket upgrade response exceeded ${MAX_UPGRADE_RESPONSE_BYTES} bytes`,
            ),
          );
          return;
        }
        response[responseLength] = byte;
        responseLength += 1;
        if (
          responseLength >= 4 &&
          response[responseLength - 4] === 13 &&
          response[responseLength - 3] === 10 &&
          response[responseLength - 2] === 13 &&
          response[responseLength - 1] === 10
        ) {
          const header = responseText();
          if (!header.startsWith("HTTP/1.1 101 ")) {
            fail(
              new Error(
                `WebSocket upgrade failed: ${sanitizeDiagnosticText(header)}`,
              ),
            );
            return;
          }
          // Deliberately never parse or acknowledge the server close frame.
          succeed();
          return;
        }
      }
      if (responseLength >= MAX_UPGRADE_RESPONSE_BYTES) {
        fail(
          new Error(
            `WebSocket upgrade response exceeded ${MAX_UPGRADE_RESPONSE_BYTES} bytes`,
          ),
        );
      }
    };
    socket.once("error", fail);
    socket.on("data", onData);
    socket.once("connect", () => {
      socket.write(
        "GET /ws HTTP/1.1\r\n" +
          `Host: 127.0.0.1:${port}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: AQEBAQEBAQEBAQEBAQEBAQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          `Origin: ${TEST_ORIGIN}\r\n` +
          "\r\n",
      );
    });
  });
  return { socket, opened, closed };
}

async function finishScenario(
  container,
  startedAt,
  shutdownGraceMs,
  options = {},
) {
  const shutdownStartedAt = options.shutdownStartedAt ?? startedAt;
  const deadline =
    options.deadline ?? shutdownStartedAt + shutdownGraceMs + STOP_MARGIN_MS;
  const state = await waitForStopped(
    container.name,
    remainingUntil(deadline, `${container.name} stop`),
  );
  const elapsedMs = Date.now() - startedAt;
  const shutdownElapsedMs = Date.now() - shutdownStartedAt;
  invariant(state.ExitCode === 0, `container exit was ${state.ExitCode}`);
  invariant(state.OOMKilled === false, "container was OOM-killed");
  invariant(state.Pid === 0, `container retained PID ${state.Pid}`);
  invariant(
    shutdownElapsedMs <= shutdownGraceMs + STOP_MARGIN_MS,
    `shutdown exceeded budget: ${shutdownElapsedMs}ms`,
  );
  await assertPortClosed(
    container.port,
    remainingUntil(deadline, `${container.name} port close`),
  );
  const top = await docker(["top", container.name], {
    allowFailure: true,
    outputMaxBytes: MAX_CONTAINER_METADATA_BYTES,
    timeoutMs: remainingUntil(deadline, `${container.name} process check`),
  });
  invariant(top.code !== 0, "stopped container still exposes a process tree");
  return {
    state,
    elapsedMs,
    logs: await logsFor(
      container.name,
      remainingUntil(deadline, `${container.name} log collection`),
    ),
  };
}

async function gracefulScenario(image) {
  const shutdownGraceMs = 4_000;
  const socketCloseGraceMs = 1_000;
  const container = await runContainer(
    image,
    "graceful",
    shutdownGraceMs,
    socketCloseGraceMs,
  );
  const peer = openWebSocket(container.port);
  try {
    await withTimeout(peer.opened, START_TIMEOUT_MS, "WebSocket open");
    const startedAt = Date.now();
    const deadline = startedAt + shutdownGraceMs + STOP_MARGIN_MS;
    await docker(["kill", "--signal=TERM", container.name], {
      timeoutMs: remainingUntil(deadline, "graceful shutdown signal"),
    });
    const peerTimeoutMs = remainingUntil(deadline, "graceful shutdown peer");
    const [notice, close] = await Promise.all([
      withTimeout(peer.maintenance, peerTimeoutMs, "maintenance notice"),
      withTimeout(peer.closed, peerTimeoutMs, "WebSocket close"),
    ]);
    invariant(
      typeof notice.deadline === "string",
      "terminating notice lacks deadline",
    );
    invariant(close.code === 1012, `unexpected close code ${close.code}`);
    invariant(
      close.reason === "service restart",
      `unexpected close reason ${close.reason}`,
    );
    const result = await finishScenario(container, startedAt, shutdownGraceMs, {
      deadline,
    });
    const records = eventRecords(result.logs);
    assertCommonEvents(records);
    invariant(
      eventCount(records, "shutdown-force-closed") === 0,
      "graceful peer was force-closed",
    );
    invariant(
      eventCount(records, "shutdown-second-signal") === 0,
      "unexpected second signal",
    );
    return Object.freeze({
      scenario: "graceful",
      elapsedMs: result.elapsedMs,
      close,
      processTree: container.processTree,
    });
  } finally {
    peer.socket.terminate();
    await cleanupContainer(container.name, container.runId);
  }
}

async function socketCloseSubdeadlineScenario(image) {
  const shutdownGraceMs = 4_000;
  const socketCloseGraceMs = 1_000;
  const container = await runContainer(
    image,
    "subdeadline",
    shutdownGraceMs,
    socketCloseGraceMs,
  );
  const peer = openUncooperativeWebSocket(container.port);
  try {
    await withTimeout(peer.opened, START_TIMEOUT_MS, "raw WebSocket open");
    const startedAt = Date.now();
    const deadline = startedAt + shutdownGraceMs + STOP_MARGIN_MS;
    await docker(["kill", "--signal=TERM", container.name], {
      timeoutMs: remainingUntil(deadline, "subdeadline shutdown signal"),
    });
    const result = await finishScenario(container, startedAt, shutdownGraceMs, {
      deadline,
    });
    peer.socket.resume();
    await withTimeout(
      peer.closed,
      remainingUntil(deadline, "raw WebSocket close"),
      "raw WebSocket close",
    );
    const records = eventRecords(result.logs);
    assertCommonEvents(records);
    invariant(
      eventCount(records, "shutdown-force-closed") === 1,
      "socket close subdeadline must force-close once",
    );
    invariant(
      eventCount(records, "shutdown-second-signal") === 0,
      "unexpected second signal",
    );
    invariant(
      result.elapsedMs >= socketCloseGraceMs - 200,
      `uncooperative peer closed before the subdeadline: ${result.elapsedMs}ms`,
    );
    return Object.freeze({
      scenario: "socket-close-subdeadline-force",
      elapsedMs: result.elapsedMs,
      processTree: container.processTree,
    });
  } finally {
    peer.socket.destroy();
    await cleanupContainer(container.name, container.runId);
  }
}

async function secondSignalScenario(image) {
  const shutdownGraceMs = 10_000;
  const socketCloseGraceMs = 5_000;
  const container = await runContainer(
    image,
    "second",
    shutdownGraceMs,
    socketCloseGraceMs,
  );
  const peer = openUncooperativeWebSocket(container.port);
  try {
    await withTimeout(peer.opened, START_TIMEOUT_MS, "raw WebSocket open");
    const shutdownStartedAt = Date.now();
    const deadline = shutdownStartedAt + shutdownGraceMs + STOP_MARGIN_MS;
    await docker(["kill", "--signal=TERM", container.name], {
      timeoutMs: remainingUntil(deadline, "second-signal first shutdown signal"),
    });
    await waitForLogEvent(
      container.name,
      "shutdown-close-started",
      remainingUntil(deadline, "second-signal shutdown progress"),
    );
    const secondSignalAt = Date.now();
    await docker(["kill", "--signal=INT", container.name], {
      timeoutMs: remainingUntil(deadline, "second-signal interrupt"),
    });
    const result = await finishScenario(
      container,
      secondSignalAt,
      shutdownGraceMs,
      { shutdownStartedAt, deadline },
    );
    peer.socket.resume();
    await withTimeout(
      peer.closed,
      remainingUntil(deadline, "raw WebSocket close"),
      "raw WebSocket close",
    );
    const records = eventRecords(result.logs);
    assertCommonEvents(records, 2);
    invariant(
      eventCount(records, "shutdown-second-signal") === 1,
      "second signal event must occur once",
    );
    invariant(
      eventCount(records, "shutdown-force-closed") === 1,
      "second signal must force-close once",
    );
    const signals = records.filter(
      (record) => record.event === "shutdown-signal-received",
    );
    invariant(
      signals.length === 2,
      `expected two signal receipts, got ${signals.length}`,
    );
    invariant(signals[1]?.signal === "SIGINT", "second signal must be SIGINT");
    invariant(signals[1]?.ordinal === 2, "second signal ordinal must be two");
    invariant(
      result.elapsedMs < socketCloseGraceMs,
      `second signal did not accelerate cleanup: ${result.elapsedMs}ms`,
    );
    return Object.freeze({
      scenario: "second-signal-force",
      elapsedMs: result.elapsedMs,
      processTree: container.processTree,
    });
  } finally {
    peer.socket.destroy();
    await cleanupContainer(container.name, container.runId);
  }
}

async function main() {
  const { image } = parseArguments(process.argv.slice(2));
  const inspected = await docker([
    "image",
    "inspect",
    image,
    "--format",
    "{{json .Id}}\t{{json .Config.Cmd}}\t{{json .Config.User}}",
  ], {
    outputMaxBytes: MAX_IMAGE_METADATA_BYTES,
  });
  const [imageId, command, imageUserValue] = parseBoundedJsonFields(
    inspected.stdout,
    3,
    "image",
  );
  const imageUser = assertExplicitNonRootImageUser(imageUserValue);
  invariant(
    typeof imageId === "string" && /^sha256:[0-9a-f]{64}$/.test(imageId),
    `image does not have an immutable ID: ${String(imageId)}`,
  );
  invariant(
    JSON.stringify(command) ===
      JSON.stringify(["node", "--import", "tsx", "server/start.ts"]),
    `image CMD is not direct Node: ${JSON.stringify(command)}`,
  );
  const results = [];
  results.push(await gracefulScenario(imageId));
  results.push(await socketCloseSubdeadlineScenario(imageId));
  results.push(await secondSignalScenario(imageId));
  console.log(
    JSON.stringify({
      ok: true,
      requestedImage: image,
      imageId,
      imageUser,
      command,
      results,
    }),
  );
}

void main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error:
        error instanceof Error
          ? sanitizeDiagnosticText(error.message)
          : "unknown error",
    }),
  );
  process.exitCode = 1;
});
