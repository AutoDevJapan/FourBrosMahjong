import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 30_000;
const PROBE_EVIDENCE_SCHEMA_VERSION = 2;
const ENVIRONMENT_KEYS = Object.freeze({
  baseUrl: "ONLINE_PROBE_BASE_URL",
  allowedOrigin: "ONLINE_PROBE_ALLOWED_ORIGIN",
  disallowedOrigin: "ONLINE_PROBE_DISALLOWED_ORIGIN",
  timeoutMs: "ONLINE_PROBE_TIMEOUT_MS",
});

const EXPECTED = Object.freeze({
  health: 200,
  readiness: 200,
  allowedOrigin: 101,
  disallowedOrigin: 403,
  missingOrigin: 403,
});

function usage() {
  return [
    "Usage:",
    "  node scripts/probe-online-boundary.mjs \\",
    "    --base-url https://online.example.com \\",
    "    --allowed-origin https://app.example.com \\",
    "    --disallowed-origin https://not-allowed.example \\",
    "    [--timeout-ms 10000]",
    "",
    "The probe performs GET /healthz, GET /readyz, and three HTTP Upgrade handshakes only.",
    "It never sends a WebSocket application message.",
    "CLI options override ONLINE_PROBE_BASE_URL, ONLINE_PROBE_ALLOWED_ORIGIN,",
    "ONLINE_PROBE_DISALLOWED_ORIGIN, and ONLINE_PROBE_TIMEOUT_MS.",
  ].join("\n");
}

function optionValue(args, index, option) {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function setOption(options, key, value, option) {
  if (options[key] !== undefined) {
    throw new Error(`${option} must not be repeated`);
  }
  options[key] = value;
}

/**
 * @param {readonly string[]} args
 * @param {Readonly<Record<string, string | undefined>>} environment
 */
export function parseProbeArguments(args, environment = process.env) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--help") return { help: true };
    if (option === "--base-url") {
      setOption(options, "baseUrl", optionValue(args, index, option), option);
      index += 1;
      continue;
    }
    if (option === "--allowed-origin") {
      setOption(
        options,
        "allowedOrigin",
        optionValue(args, index, option),
        option,
      );
      index += 1;
      continue;
    }
    if (option === "--disallowed-origin") {
      setOption(
        options,
        "disallowedOrigin",
        optionValue(args, index, option),
        option,
      );
      index += 1;
      continue;
    }
    if (option === "--timeout-ms") {
      setOption(options, "timeoutMs", optionValue(args, index, option), option);
      index += 1;
      continue;
    }
    throw new Error(`unknown option: ${option}`);
  }

  const baseUrl = parseBaseUrl(
    options.baseUrl ?? environment[ENVIRONMENT_KEYS.baseUrl],
  );
  const allowedOrigin = parseOrigin(
    options.allowedOrigin ?? environment[ENVIRONMENT_KEYS.allowedOrigin],
    "--allowed-origin",
  );
  const disallowedOrigin = parseOrigin(
    options.disallowedOrigin ?? environment[ENVIRONMENT_KEYS.disallowedOrigin],
    "--disallowed-origin",
  );
  if (allowedOrigin === disallowedOrigin) {
    throw new Error("allowed and disallowed origins must be different");
  }

  const timeoutMs = parseTimeout(
    options.timeoutMs ?? environment[ENVIRONMENT_KEYS.timeoutMs],
  );
  return {
    help: false,
    baseUrl,
    allowedOrigin,
    disallowedOrigin,
    timeoutMs,
  };
}

function parseBaseUrl(value) {
  if (typeof value !== "string") throw new Error("--base-url is required");
  const url = parseHttpUrl(value, "--base-url");
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      "--base-url must be an origin without a path, query, or hash",
    );
  }
  return url.origin;
}

function parseOrigin(value, option) {
  if (typeof value !== "string") throw new Error(`${option} is required`);
  const url = parseHttpUrl(value, option);
  if (url.origin !== value || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${option} must be an exact HTTP(S) origin`);
  }
  return url.origin;
}

function parseHttpUrl(value, option) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${option} must be a valid URL`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${option} must use http or https`);
  }
  if (url.username || url.password) {
    throw new Error(`${option} must not contain credentials`);
  }
  return url;
}

function parseTimeout(value) {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!/^\d+$/.test(value)) throw new Error("--timeout-ms must be an integer");
  const timeoutMs = Number(value);
  if (timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(
      `--timeout-ms must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS}`,
    );
  }
  return timeoutMs;
}

function errorMessage(error) {
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  if (error instanceof Error && error.name === "TimeoutError") return "timeout";
  return error instanceof Error ? error.message : String(error);
}

async function probeHttp(path, baseUrl, timeoutMs) {
  const startedAt = new Date().toISOString();
  try {
    const response = await fetch(new URL(path, baseUrl), {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
    });
    try {
      const body = await response.json();
      return { startedAt, statusCode: response.status, body };
    } catch (error) {
      const message = errorMessage(error);
      return {
        startedAt,
        statusCode: response.status,
        error: message === "timeout" ? "timeout" : "invalid_json",
      };
    }
  } catch (error) {
    return { startedAt, statusCode: null, error: errorMessage(error) };
  }
}

async function probeHealth(baseUrl, timeoutMs) {
  return probeHttp("/healthz", baseUrl, timeoutMs);
}

async function probeReadiness(baseUrl, timeoutMs) {
  return probeHttp("/readyz", baseUrl, timeoutMs);
}

/**
 * Perform an HTTP Upgrade handshake and destroy an accepted socket immediately.
 * Deliberately do not call `socket.write()` or WebSocket APIs: no application
 * frame (including a Close frame) is sent to the target.
 */
function createUpgradeRequest(target, options) {
  const request = target.protocol === "https:" ? httpsRequest : httpRequest;
  return request(options);
}

export async function probeUpgrade(
  baseUrl,
  origin,
  timeoutMs,
  requestFactory = createUpgradeRequest,
) {
  const target = new URL("/ws", baseUrl);
  const startedAt = new Date().toISOString();

  return new Promise((resolveProbe) => {
    let settled = false;
    let timer;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolveProbe({ startedAt, ...result });
    };
    const headers = {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Key": randomBytes(16).toString("base64"),
      "Sec-WebSocket-Version": "13",
      ...(origin === undefined ? {} : { Origin: origin }),
    };
    const upgradeRequest = requestFactory(target, {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: "GET",
      headers,
      agent: false,
    });
    timer = setTimeout(() => {
      settle({ statusCode: null, error: "timeout" });
      upgradeRequest.destroy(new Error("probe timeout"));
    }, timeoutMs);
    upgradeRequest.once("upgrade", (response, socket) => {
      const statusCode = response.statusCode ?? 101;
      socket.destroy();
      settle({ statusCode });
    });
    upgradeRequest.once("response", (response) => {
      const statusCode = response.statusCode ?? null;
      response.destroy();
      settle({ statusCode });
    });
    upgradeRequest.once("error", (error) => {
      settle({ statusCode: null, error: errorMessage(error) });
    });
    upgradeRequest.end();
  });
}

function matches(result, expectedStatus) {
  return (
    result.error === undefined &&
    result.statusCode === expectedStatus &&
    (expectedStatus !== 200 || result.body?.ok === true)
  );
}

export async function runBoundaryProbe({
  baseUrl,
  allowedOrigin,
  disallowedOrigin,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const startedAt = new Date().toISOString();
  const health = await probeHealth(baseUrl, timeoutMs);
  const readiness = await probeReadiness(baseUrl, timeoutMs);
  const allowed = await probeUpgrade(baseUrl, allowedOrigin, timeoutMs);
  const disallowed = await probeUpgrade(baseUrl, disallowedOrigin, timeoutMs);
  const missing = await probeUpgrade(baseUrl, undefined, timeoutMs);
  const checks = {
    health: { expectedStatus: EXPECTED.health, ...health },
    readiness: { expectedStatus: EXPECTED.readiness, ...readiness },
    allowedOrigin: {
      origin: allowedOrigin,
      expectedStatus: EXPECTED.allowedOrigin,
      ...allowed,
    },
    disallowedOrigin: {
      origin: disallowedOrigin,
      expectedStatus: EXPECTED.disallowedOrigin,
      ...disallowed,
    },
    missingOrigin: {
      expectedStatus: EXPECTED.missingOrigin,
      ...missing,
    },
  };
  const ok = Object.entries(checks).every(([name, result]) =>
    matches(result, EXPECTED[name]),
  );
  return {
    schemaVersion: PROBE_EVIDENCE_SCHEMA_VERSION,
    ok,
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl,
    checks,
  };
}

export async function main(args = process.argv.slice(2)) {
  let options;
  try {
    options = parseProbeArguments(args);
  } catch (error) {
    console.error(errorMessage(error));
    console.error(usage());
    return 2;
  }
  if (options.help) {
    console.log(usage());
    return 0;
  }
  const evidence = await runBoundaryProbe(options);
  console.log(JSON.stringify(evidence, null, 2));
  return evidence.ok ? 0 : 1;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
