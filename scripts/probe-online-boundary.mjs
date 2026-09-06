import { createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 30_000;
const DNS_LOOKUP_TIMEOUT_MS = 5_000;
const MAX_HEALTH_BODY_BYTES = 4_096;
const PROBE_EVIDENCE_SCHEMA_VERSION = 2;
const EXPECTED_HEALTH_SERVICE = "four-bros-mahjong-online";
const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const UNSAFE_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data.ec2.internal",
]);
function blockList(ranges, family) {
  const list = new BlockList();
  for (const [address, prefix] of ranges) {
    list.addSubnet(address, prefix, family);
  }
  return list;
}
const UNSAFE_IPV4 = blockList(
  [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ],
  "ipv4",
);
const UNSAFE_IPV6 = blockList(
  [
    ["::", 96],
    ["::1", 128],
    ["::ffff:0:0", 96],
    ["2001:db8::", 32],
    ["fc00::", 7],
    ["fe80::", 10],
    ["fec0::", 10],
    ["ff00::", 8],
  ],
  "ipv6",
);
const LOOPBACK_IPV4 = blockList([["127.0.0.0", 8]], "ipv4");
const LOOPBACK_IPV6 = blockList([["::1", 128]], "ipv6");
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
    "    [--timeout-ms 10000] [--allow-local-target]",
    "",
    "The probe performs GET /healthz, GET /readyz, and three HTTP Upgrade handshakes only.",
    "It never sends a WebSocket application message.",
    "Production targets must resolve only to public IP addresses.",
    "--allow-local-target is for controlled loopback-only local tests.",
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
    if (option === "--allow-local-target") {
      if (options.allowLocalTarget === true) {
        throw new Error(`${option} must not be repeated`);
      }
      options.allowLocalTarget = true;
      continue;
    }
    throw new Error(`unknown option: ${option}`);
  }

  const allowLocalTarget = options.allowLocalTarget === true;
  const baseUrl = parseBaseUrl(
    options.baseUrl ?? environment[ENVIRONMENT_KEYS.baseUrl],
    allowLocalTarget,
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
    allowLocalTarget,
  };
}

function parseBaseUrl(value, allowLocalTarget = false) {
  if (typeof value !== "string") throw new Error("--base-url is required");
  const url = parseHttpUrl(value, "--base-url");
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(
      "--base-url must be an origin without a path, query, or hash",
    );
  }
  validateTargetHostname(url, "--base-url", allowLocalTarget);
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
  if (url.hostname.includes("*")) {
    throw new Error(`${option} must not contain a wildcard host`);
  }
  if (url.username || url.password) {
    throw new Error(`${option} must not contain credentials`);
  }
  return url;
}

function normalizedHostname(url) {
  return url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

function isUnsafeIp(address) {
  const family = isIP(address);
  if (family === 4) return UNSAFE_IPV4.check(address, "ipv4");
  if (family === 6) return UNSAFE_IPV6.check(address, "ipv6");
  return true;
}

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (normalized === "localhost") return true;
  const family = isIP(normalized);
  if (family === 4) return LOOPBACK_IPV4.check(normalized, "ipv4");
  return family === 6 && LOOPBACK_IPV6.check(normalized, "ipv6");
}

function validateTargetHostname(url, option, allowLocalTarget) {
  const hostname = normalizedHostname(url);
  const family = isIP(hostname);
  if (allowLocalTarget) {
    if (!isLoopbackHostname(hostname)) {
      throw new Error(
        `${option} local opt-in only permits localhost or loopback addresses`,
      );
    }
    return;
  }
  if (
    UNSAFE_HOSTNAMES.has(hostname) ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    (family !== 0 && isUnsafeIp(hostname))
  ) {
    throw new Error(`${option} must target a public, non-private host`);
  }
  if (hostname.length === 0 || !hostname.includes(".")) {
    throw new Error(`${option} must target a public hostname`);
  }
}

function isLoopbackAddress(address) {
  const family = isIP(address);
  if (family === 4) return LOOPBACK_IPV4.check(address, "ipv4");
  return family === 6 && LOOPBACK_IPV6.check(address, "ipv6");
}

class ProbeTargetError extends Error {
  constructor(code) {
    super(code);
    this.name = "ProbeTargetError";
    this.code = code;
  }
}

function targetErrorCode(error) {
  return error instanceof ProbeTargetError ? error.code : undefined;
}

async function lookupWithTimeout(hostname, timeoutMs, lookupFunction) {
  const boundedTimeoutMs = Math.min(timeoutMs, DNS_LOOKUP_TIMEOUT_MS);
  let timer;
  const lookupPromise = Promise.resolve().then(() =>
    lookupFunction(hostname, { all: true, verbatim: true }),
  );
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new ProbeTargetError("dns_timeout")),
      boundedTimeoutMs,
    );
  });
  try {
    return await Promise.race([lookupPromise, timeoutPromise]);
  } catch (error) {
    if (targetErrorCode(error) !== undefined) throw error;
    throw new ProbeTargetError("dns_lookup_failed");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function resolveProbeTarget(
  baseUrl,
  timeoutMs,
  allowLocalTarget = false,
  lookupFunction = lookup,
) {
  const url = new URL(baseUrl);
  const hostname = normalizedHostname(url);
  if (isIP(hostname) !== 0) {
    return Object.freeze({
      address: hostname,
      family: isIP(hostname),
      hostname,
    });
  }
  const addresses = await lookupWithTimeout(
    hostname,
    timeoutMs,
    lookupFunction,
  );
  if (
    !Array.isArray(addresses) ||
    addresses.length === 0 ||
    addresses.some(
      ({ address, family }) =>
        typeof address !== "string" ||
        ![4, 6].includes(family) ||
        (allowLocalTarget ? !isLoopbackAddress(address) : isUnsafeIp(address)),
    )
  ) {
    throw new ProbeTargetError(
      allowLocalTarget ? "local_target_not_loopback" : "target_not_public",
    );
  }
  const [selected] = addresses;
  return Object.freeze({
    address: selected.address,
    family: selected.family,
    hostname,
  });
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

class ProbeBodyError extends Error {
  constructor(code) {
    super(code);
    this.name = "ProbeBodyError";
    this.code = code;
  }
}

function bodyErrorCode(error) {
  return error instanceof ProbeBodyError ? error.code : undefined;
}

function parseDeclaredContentLength(value) {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) throw new ProbeBodyError("invalid_body_length");
  if (!/^\d+$/.test(value)) {
    throw new ProbeBodyError("invalid_body_length");
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length)) {
    throw new ProbeBodyError("invalid_body_length");
  }
  return length;
}

function declaredContentLength(response) {
  return parseDeclaredContentLength(response.headers.get("content-length"));
}

async function cancelResponseBody(response) {
  if (response.body === null) return;
  try {
    await response.body.cancel();
  } catch {
    // The body is already being rejected; cancellation failures are not useful
    // evidence and must not replace the bounded-body result.
  }
}

function destroyIncomingResponse(response) {
  try {
    response.destroy();
  } catch {
    // The response is already being rejected; destruction is best effort.
  }
}

function readBoundedIncomingResponseBody(response) {
  let expectedLength;
  try {
    expectedLength = parseDeclaredContentLength(
      response.headers["content-length"],
    );
  } catch (error) {
    destroyIncomingResponse(response);
    return Promise.reject(error);
  }
  if (expectedLength !== undefined && expectedLength > MAX_HEALTH_BODY_BYTES) {
    destroyIncomingResponse(response);
    return Promise.reject(new ProbeBodyError("body_too_large"));
  }

  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let receivedBytes = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      destroyIncomingResponse(response);
      rejectBody(error);
    };
    response.on("data", (chunk) => {
      if (settled) return;
      try {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        receivedBytes += bytes.byteLength;
        if (receivedBytes > MAX_HEALTH_BODY_BYTES) {
          fail(new ProbeBodyError("body_too_large"));
          return;
        }
        chunks.push(bytes);
      } catch (error) {
        fail(error);
      }
    });
    response.once("end", () => {
      if (settled) return;
      if (expectedLength !== undefined && receivedBytes !== expectedLength) {
        fail(
          new ProbeBodyError(
            receivedBytes < expectedLength
              ? "truncated_body"
              : "invalid_body_length",
          ),
        );
        return;
      }
      settled = true;
      resolveBody(Uint8Array.from(Buffer.concat(chunks)));
    });
    response.once("aborted", () => {
      fail(new ProbeBodyError("truncated_body"));
    });
    response.once("error", (error) => {
      fail(error);
    });
  });
}

export async function readBoundedResponseBody(response) {
  let expectedLength;
  try {
    expectedLength = declaredContentLength(response);
  } catch (error) {
    await cancelResponseBody(response);
    throw error;
  }
  if (expectedLength !== undefined && expectedLength > MAX_HEALTH_BODY_BYTES) {
    await cancelResponseBody(response);
    throw new ProbeBodyError("body_too_large");
  }

  if (response.body === null) {
    if (expectedLength !== undefined && expectedLength !== 0) {
      await cancelResponseBody(response);
      throw new ProbeBodyError("truncated_body");
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
  let completed = false;
  try {
    while (true) {
      let result;
      try {
        result = await reader.read();
      } catch (error) {
        if (errorMessage(error) === "timeout") throw error;
        if (expectedLength !== undefined && receivedBytes < expectedLength) {
          throw new ProbeBodyError("truncated_body");
        }
        throw error;
      }
      if (result.done) break;
      if (!(result.value instanceof Uint8Array)) {
        throw new ProbeBodyError("invalid_body");
      }
      receivedBytes += result.value.byteLength;
      if (receivedBytes > MAX_HEALTH_BODY_BYTES) {
        throw new ProbeBodyError("body_too_large");
      }
      chunks.push(result.value);
    }
    if (expectedLength !== undefined && receivedBytes !== expectedLength) {
      throw new ProbeBodyError(
        receivedBytes < expectedLength
          ? "truncated_body"
          : "invalid_body_length",
      );
    }

    const bytes = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    completed = true;
    return bytes;
  } finally {
    if (!completed) {
      try {
        await reader.cancel();
      } catch {
        // Preserve the bounded-body error even if the stream is already closed.
      }
    }
    try {
      reader.releaseLock();
    } catch {
      // Preserve the original body error when the reader is already released.
    }
  }
}

function parseHealthBody(bytes, path) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { error: "invalid_json" };
  }

  let value;
  try {
    value = parseJsonWithUniqueKeys(text);
  } catch {
    return { error: "invalid_json" };
  }

  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { error: "invalid_schema" };
  }
  const keys = Object.keys(value);
  const allowedKeys = path === "/healthz" ? ["ok", "service"] : ["ok"];
  const hasService = Object.prototype.hasOwnProperty.call(value, "service");
  if (
    !Object.prototype.hasOwnProperty.call(value, "ok") ||
    keys.some((key) => !allowedKeys.includes(key)) ||
    typeof value.ok !== "boolean" ||
    (path === "/healthz" &&
      (!hasService || value.service !== EXPECTED_HEALTH_SERVICE))
  ) {
    return { error: "invalid_schema" };
  }

  return { body: { ok: value.ok } };
}

function parseJsonWithUniqueKeys(text) {
  const cursor = { index: 0 };

  function skipWhitespace() {
    while (/[ \t\r\n]/.test(text[cursor.index] ?? "")) {
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

function pinnedLookup(probeTarget) {
  return (_hostname, _options, callback) => {
    callback(null, probeTarget.address, probeTarget.family);
  };
}

function requestOptions(target, probeTarget, headers, method = "GET") {
  const hostname = probeTarget?.address ?? target.hostname;
  const options = {
    protocol: target.protocol,
    hostname,
    port: target.port,
    path: `${target.pathname}${target.search}`,
    method,
    headers: {
      ...headers,
      Host: target.host,
    },
    agent: false,
  };
  if (probeTarget !== undefined) {
    options.lookup = pinnedLookup(probeTarget);
    if (
      target.protocol === "https:" &&
      isIP(normalizedHostname(target)) === 0
    ) {
      options.servername = normalizedHostname(target);
    }
  }
  return options;
}

function requestErrorCode(error) {
  if (errorMessage(error) === "timeout") return "timeout";
  if (
    error &&
    typeof error.code === "string" &&
    /^[A-Z][A-Z0-9_]+$/.test(error.code)
  ) {
    return error.code;
  }
  return "request_failed";
}

async function probeHttp(path, baseUrl, timeoutMs, probeTarget) {
  const startedAt = new Date().toISOString();
  const target = new URL(path, baseUrl);
  const request = target.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolveProbe) => {
    let settled = false;
    let timer;
    let requestHandle;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolveProbe({ startedAt, ...result });
    };
    try {
      requestHandle = request(
        requestOptions(target, probeTarget, {
          accept: "application/json",
          "accept-encoding": "identity",
        }),
      );
      timer = setTimeout(() => {
        settle({ statusCode: null, error: "timeout" });
        requestHandle.destroy(new Error("probe timeout"));
      }, timeoutMs);
      requestHandle.once("response", (response) => {
        void (async () => {
          const statusCode = response.statusCode ?? null;
          try {
            const parsed = parseHealthBody(
              await readBoundedIncomingResponseBody(response),
              path,
            );
            settle({
              statusCode,
              ...(statusCode === 404 && parsed.body === undefined
                ? { error: "endpoint_missing" }
                : parsed),
            });
          } catch (error) {
            const message = errorMessage(error);
            settle({
              statusCode,
              error:
                message === "timeout"
                  ? "timeout"
                  : (bodyErrorCode(error) ?? "invalid_json"),
            });
          }
        })();
      });
      requestHandle.once("error", (error) => {
        settle({ statusCode: null, error: requestErrorCode(error) });
      });
      requestHandle.end();
    } catch (error) {
      settle({ statusCode: null, error: requestErrorCode(error) });
    }
  });
}

async function probeHealth(baseUrl, timeoutMs, probeTarget) {
  return probeHttp("/healthz", baseUrl, timeoutMs, probeTarget);
}

async function probeReadiness(baseUrl, timeoutMs, probeTarget) {
  return probeHttp("/readyz", baseUrl, timeoutMs, probeTarget);
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

function expectedWebSocketAccept(key) {
  return createHash("sha1")
    .update(`${key}${WEBSOCKET_GUID}`, "ascii")
    .digest("base64");
}

function singleHeader(headers, name) {
  const value = headers?.[name];
  return typeof value === "string" ? value : null;
}

function hasHeaderToken(value, expected) {
  return (
    typeof value === "string" &&
    value.split(",").some((token) => token.trim().toLowerCase() === expected)
  );
}

function isValidWebSocketUpgrade(response, key) {
  if (response?.statusCode !== 101) return false;
  const headers = response.headers;
  return (
    singleHeader(headers, "upgrade")?.trim().toLowerCase() === "websocket" &&
    hasHeaderToken(singleHeader(headers, "connection"), "upgrade") &&
    singleHeader(headers, "sec-websocket-accept") ===
      expectedWebSocketAccept(key)
  );
}

export async function probeUpgrade(
  baseUrl,
  origin,
  timeoutMs,
  requestFactory = createUpgradeRequest,
  probeTarget,
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
    const webSocketKey = randomBytes(16).toString("base64");
    const headers = {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Key": webSocketKey,
      "Sec-WebSocket-Version": "13",
      ...(origin === undefined ? {} : { Origin: origin }),
    };
    const upgradeRequest = requestFactory(
      target,
      requestOptions(target, probeTarget, headers),
    );
    timer = setTimeout(() => {
      settle({ statusCode: null, error: "timeout" });
      upgradeRequest.destroy(new Error("probe timeout"));
    }, timeoutMs);
    upgradeRequest.once("upgrade", (response, socket) => {
      const statusCode = response.statusCode ?? null;
      socket.destroy();
      settle({
        statusCode,
        ...(isValidWebSocketUpgrade(response, webSocketKey)
          ? {}
          : { error: "invalid_upgrade" }),
      });
    });
    upgradeRequest.once("response", (response) => {
      const statusCode = response.statusCode ?? null;
      response.destroy();
      settle({ statusCode });
    });
    upgradeRequest.once("error", (error) => {
      // Probe evidence can be attached to an issue. Keep transport failures
      // code-only so arbitrary Error.message values cannot leak into it.
      settle({ statusCode: null, error: requestErrorCode(error) });
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

const PROBE_CHECK_NAMES = Object.freeze([
  "health",
  "readiness",
  "allowedOrigin",
  "disallowedOrigin",
  "missingOrigin",
]);

function targetFailureEvidence(baseUrl, startedAt, error) {
  const errorCode = targetErrorCode(error) ?? "target_unavailable";
  const checks = Object.fromEntries(
    PROBE_CHECK_NAMES.map((name) => [
      name,
      {
        expectedStatus: EXPECTED[name],
        statusCode: null,
        error: errorCode,
      },
    ]),
  );
  return {
    schemaVersion: PROBE_EVIDENCE_SCHEMA_VERSION,
    ok: false,
    startedAt,
    finishedAt: new Date().toISOString(),
    baseUrl,
    target: { error: errorCode },
    checks,
  };
}

export async function runBoundaryProbe({
  baseUrl,
  allowedOrigin,
  disallowedOrigin,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  allowLocalTarget = false,
  lookupFunction = lookup,
}) {
  const normalizedBaseUrl = parseBaseUrl(baseUrl, allowLocalTarget);
  const normalizedAllowedOrigin = parseOrigin(
    allowedOrigin,
    "--allowed-origin",
  );
  const normalizedDisallowedOrigin = parseOrigin(
    disallowedOrigin,
    "--disallowed-origin",
  );
  if (normalizedAllowedOrigin === normalizedDisallowedOrigin) {
    throw new Error("allowed and disallowed origins must be different");
  }
  const startedAt = new Date().toISOString();
  let probeTarget;
  try {
    probeTarget = await resolveProbeTarget(
      normalizedBaseUrl,
      timeoutMs,
      allowLocalTarget,
      lookupFunction ?? lookup,
    );
  } catch (error) {
    return targetFailureEvidence(normalizedBaseUrl, startedAt, error);
  }
  const health = await probeHealth(normalizedBaseUrl, timeoutMs, probeTarget);
  const readiness = await probeReadiness(
    normalizedBaseUrl,
    timeoutMs,
    probeTarget,
  );
  const allowed = await probeUpgrade(
    normalizedBaseUrl,
    normalizedAllowedOrigin,
    timeoutMs,
    createUpgradeRequest,
    probeTarget,
  );
  const disallowed = await probeUpgrade(
    normalizedBaseUrl,
    normalizedDisallowedOrigin,
    timeoutMs,
    createUpgradeRequest,
    probeTarget,
  );
  const missing = await probeUpgrade(
    normalizedBaseUrl,
    undefined,
    timeoutMs,
    createUpgradeRequest,
    probeTarget,
  );
  const checks = {
    health: { expectedStatus: EXPECTED.health, ...health },
    readiness: { expectedStatus: EXPECTED.readiness, ...readiness },
    allowedOrigin: {
      origin: normalizedAllowedOrigin,
      expectedStatus: EXPECTED.allowedOrigin,
      ...allowed,
    },
    disallowedOrigin: {
      origin: normalizedDisallowedOrigin,
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
    baseUrl: normalizedBaseUrl,
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
