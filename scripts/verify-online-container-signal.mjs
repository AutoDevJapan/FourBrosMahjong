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
const EXPECTED_CMDLINE = "node --import tsx server/start.ts";
const OWNERSHIP_LABEL = "com.fourbrosmahjong.signal-verifier-run";
const REQUIRED_RUNTIME_PACKAGES = ["tsx", "ws"];
const FORBIDDEN_RUNTIME_PACKAGES = ["vitest", "@playwright/test", "typescript"];
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
];

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

function run(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    let timedOut = false;
    const timeoutError = () =>
      new Error(`${command} timed out after ${timeoutMs}ms: ${args.join(" ")}`);
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(timedOut ? timeoutError() : error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const result = Object.freeze({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
      if (timedOut) {
        reject(timeoutError());
        return;
      }
      if (code === 0 || options.allowFailure === true) resolve(result);
      else {
        reject(
          new Error(
            `${command} ${args.join(" ")} failed (${code ?? signal})\n${result.stderr}`,
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
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function waitUntil(probe, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value !== null && value !== false) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(50);
  }
  throw new Error(
    `${label} timed out after ${timeoutMs}ms${
      lastError instanceof Error ? `: ${lastError.message}` : ""
    }`,
  );
}

async function containerState(name) {
  const result = await docker(["inspect", name, "--format", "{{json .State}}"]);
  return JSON.parse(result.stdout.trim());
}

async function waitForStopped(name, timeoutMs) {
  return waitUntil(
    async () => {
      const state = await containerState(name);
      return state.Running === false ? state : null;
    },
    timeoutMs,
    `${name} stop`,
  );
}

async function hostPort(name) {
  const result = await docker(["port", name, `${CONTAINER_PORT}/tcp`]);
  const match = result.stdout.trim().match(/127\.0\.0\.1:(\d+)$/);
  if (match === null)
    throw new Error(`unexpected docker port: ${result.stdout}`);
  return Number(match[1]);
}

async function waitForHealth(port) {
  return waitUntil(
    async () => {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
        signal: AbortSignal.timeout(500),
      });
      if (!response.ok) return null;
      const body = await response.json();
      return body?.ok === true ? true : null;
    },
    START_TIMEOUT_MS,
    "container health",
  );
}

async function assertPortClosed(port) {
  await waitUntil(
    async () => {
      try {
        await fetch(`http://127.0.0.1:${port}/healthz`, {
          signal: AbortSignal.timeout(250),
        });
        return null;
      } catch {
        return true;
      }
    },
    STOP_MARGIN_MS,
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
import { access, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const requiredPackages = ${JSON.stringify(REQUIRED_RUNTIME_PACKAGES)};
const forbiddenPackages = ${JSON.stringify(FORBIDDEN_RUNTIME_PACKAGES)};
const readOnlyPaths = ${JSON.stringify(READ_ONLY_RUNTIME_PATHS)};
const absentPaths = ${JSON.stringify(ABSENT_RUNTIME_PATHS)};
const pnpmStoreEntries = await readdir("/app/node_modules/.pnpm");

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

function pnpmStoreContains(packageName) {
  const prefix = packageName.startsWith("@")
    ? packageName.replace("/", "+") + "@"
    : packageName + "@";
  return pnpmStoreEntries.some((entry) => entry.startsWith(prefix));
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
const forbidden = Object.fromEntries(
  await Promise.all(
    forbiddenPackages.map(async (name) => [
      name,
      {
        direct: await directPackageExists(name),
        pnpmStore: pnpmStoreContains(name),
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
console.log(JSON.stringify({
  pid1Uids: processIds("Uid"),
  pid1Gids: processIds("Gid"),
  required,
  forbidden,
  readOnlyRuntimePaths,
  unexpectedRuntimePaths,
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
    `all PID 1 UIDs must be non-root: ${JSON.stringify(details.pid1Uids)}`,
  );
  invariant(
    Array.isArray(details.pid1Gids) &&
      details.pid1Gids.length === 4 &&
      details.pid1Gids.every(
        (value) => Number.isSafeInteger(value) && value > 0,
      ),
    `all PID 1 GIDs must be non-root: ${JSON.stringify(details.pid1Gids)}`,
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
  invariant(cmdline === EXPECTED_CMDLINE, `unexpected PID 1: ${cmdline}`);
  invariant(executable.endsWith("/node"), `PID 1 is not Node: ${executable}`);
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
    top,
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

async function cleanupContainer(name, runId, options = {}) {
  const deadline =
    Date.now() + (options.waitForAppearance === true ? STOP_MARGIN_MS : 0);
  let inspected;
  do {
    inspected = await docker(["inspect", name], { allowFailure: true });
    if (inspected.code === 0) break;
    if (Date.now() >= deadline) return;
    await delay(50);
  } while (true);
  const details = JSON.parse(inspected.stdout)[0];
  if (details?.Config?.Labels?.[OWNERSHIP_LABEL] !== runId) return;
  const state = await containerState(name);
  if (state.Running === true) {
    await docker(["kill", "--signal=KILL", name], { allowFailure: true });
  }
  await docker(["rm", name], { allowFailure: true });
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

async function logsFor(name) {
  const result = await docker(["logs", name], { allowFailure: true });
  return `${result.stdout}${result.stderr}`;
}

async function waitForLogEvent(name, event, timeoutMs = START_TIMEOUT_MS) {
  return waitUntil(
    async () => {
      const records = eventRecords(await logsFor(name));
      return records.some((record) => record.event === event) ? records : null;
    },
    timeoutMs,
    `${name} ${event}`,
  );
}

function openWebSocket(port) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
    origin: TEST_ORIGIN,
  });
  const opened = new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const maintenance = new Promise((resolve, reject) => {
    socket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === "maintenance" && message.phase === "terminating") {
          resolve(message);
        }
      } catch (error) {
        reject(error);
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
    let response = "";
    const onData = (chunk) => {
      response += chunk.toString("latin1");
      const end = response.indexOf("\r\n\r\n");
      if (end === -1) return;
      socket.off("data", onData);
      if (!response.startsWith("HTTP/1.1 101 ")) {
        reject(
          new Error(`WebSocket upgrade failed: ${response.slice(0, end)}`),
        );
        return;
      }
      // Deliberately never parse or acknowledge the server close frame.
      socket.pause();
      resolve();
    };
    socket.once("error", reject);
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

async function finishScenario(container, startedAt, shutdownGraceMs) {
  const state = await waitForStopped(
    container.name,
    shutdownGraceMs + STOP_MARGIN_MS,
  );
  const elapsedMs = Date.now() - startedAt;
  invariant(state.ExitCode === 0, `container exit was ${state.ExitCode}`);
  invariant(state.OOMKilled === false, "container was OOM-killed");
  invariant(state.Pid === 0, `container retained PID ${state.Pid}`);
  invariant(
    elapsedMs <= shutdownGraceMs + STOP_MARGIN_MS,
    `shutdown exceeded budget: ${elapsedMs}ms`,
  );
  await assertPortClosed(container.port);
  const top = await docker(["top", container.name], { allowFailure: true });
  invariant(top.code !== 0, "stopped container still exposes a process tree");
  return { state, elapsedMs, logs: await logsFor(container.name) };
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
    await docker(["kill", "--signal=TERM", container.name]);
    const [notice, close] = await Promise.all([
      withTimeout(peer.maintenance, shutdownGraceMs, "maintenance notice"),
      withTimeout(peer.closed, shutdownGraceMs, "WebSocket close"),
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
    const result = await finishScenario(container, startedAt, shutdownGraceMs);
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
    await docker(["kill", "--signal=TERM", container.name]);
    const result = await finishScenario(container, startedAt, shutdownGraceMs);
    peer.socket.resume();
    await withTimeout(peer.closed, STOP_MARGIN_MS, "raw WebSocket close");
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
    await docker(["kill", "--signal=TERM", container.name]);
    await waitForLogEvent(container.name, "shutdown-close-started");
    const secondSignalAt = Date.now();
    await docker(["kill", "--signal=INT", container.name]);
    const result = await finishScenario(
      container,
      secondSignalAt,
      shutdownGraceMs,
    );
    peer.socket.resume();
    await withTimeout(peer.closed, STOP_MARGIN_MS, "raw WebSocket close");
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
    "{{json .}}",
  ]);
  const imageDetails = JSON.parse(inspected.stdout.trim());
  const imageId = imageDetails.Id;
  const command = imageDetails.Config?.Cmd;
  const imageUser = assertExplicitNonRootImageUser(imageDetails.Config?.User);
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
      error: error instanceof Error ? error.message : "unknown error",
    }),
  );
  process.exitCode = 1;
});
