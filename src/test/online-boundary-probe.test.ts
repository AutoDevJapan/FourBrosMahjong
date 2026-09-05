import { EventEmitter } from "node:events";
import type { ClientRequest } from "node:http";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  main,
  parseProbeArguments,
  probeUpgrade,
  readBoundedResponseBody,
  runBoundaryProbe,
} from "../../scripts/probe-online-boundary.mjs";

const ALLOWED_ORIGIN = "http://allowed.local";
const DISALLOWED_ORIGIN = "http://disallowed.local";
const HEALTH_SERVICE = "four-bros-mahjong-online";

interface BoundaryFixtureOptions {
  readonly allowMissingOrigin?: boolean;
  readonly hangUpgrades?: boolean;
  readonly healthBody?: string;
  readonly readinessBody?: string;
  readonly readinessStatus?: number;
}

interface BoundaryFixture {
  readonly baseUrl: string;
  readonly applicationBytes: Buffer[];
  readonly origins: Array<string | undefined>;
  close(): Promise<void>;
}

async function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("テストサーバーのポートを取得できませんでした。"));
        return;
      }
      resolve(address.port);
    });
  });
}

async function closeServer(
  server: Server,
  sockets: Set<Socket>,
): Promise<void> {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function startBoundaryFixture({
  allowMissingOrigin = false,
  hangUpgrades = false,
  healthBody = JSON.stringify({ ok: true, service: HEALTH_SERVICE }),
  readinessBody,
  readinessStatus = 200,
}: BoundaryFixtureOptions = {}): Promise<BoundaryFixture> {
  const applicationBytes: Buffer[] = [];
  const origins: Array<string | undefined> = [];
  const sockets = new Set<Socket>();
  const server = createServer((request, response) => {
    if (request.url === "/healthz" || request.url === "/readyz") {
      const status = request.url === "/readyz" ? readinessStatus : 200;
      response.writeHead(status, { "content-type": "application/json" });
      response.end(
        request.url === "/healthz"
          ? healthBody
          : (readinessBody ?? JSON.stringify({ ok: status === 200 })),
      );
      return;
    }
    response.writeHead(404);
    response.end();
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (request, socket) => {
    const origin = request.headers.origin;
    origins.push(origin);
    if (hangUpgrades) return;
    if (
      origin === ALLOWED_ORIGIN ||
      (origin === undefined && allowMissingOrigin)
    ) {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
          "Connection: Upgrade\r\n" +
          "Upgrade: websocket\r\n" +
          "\r\n",
      );
      socket.on("data", (chunk: Buffer) => applicationBytes.push(chunk));
      return;
    }
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
  });
  const port = await listen(server);
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    applicationBytes,
    origins,
    close: () => closeServer(server, sockets),
  };
}

const openFixtures: BoundaryFixture[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.allSettled(
    openFixtures.splice(0).map((fixture) => fixture.close()),
  );
});

describe("online boundary probe arguments", () => {
  it("requires parameterized HTTP(S) origins and bounds the timeout", () => {
    expect(
      parseProbeArguments(
        [
          "--base-url",
          "https://online.example.com",
          "--allowed-origin",
          "https://app.example.com",
          "--disallowed-origin",
          "https://blocked.example",
          "--timeout-ms",
          "2500",
        ],
        {},
      ),
    ).toEqual({
      help: false,
      baseUrl: "https://online.example.com",
      allowedOrigin: "https://app.example.com",
      disallowedOrigin: "https://blocked.example",
      timeoutMs: 2500,
      allowLocalTarget: false,
    });
  });

  it("uses explicit environment fallbacks while CLI options take precedence", () => {
    const environment = {
      ONLINE_PROBE_BASE_URL: "https://env-online.example.com",
      ONLINE_PROBE_ALLOWED_ORIGIN: "https://env-app.example.com",
      ONLINE_PROBE_DISALLOWED_ORIGIN: "https://env-blocked.example",
      ONLINE_PROBE_TIMEOUT_MS: "2000",
    };
    expect(parseProbeArguments([], environment)).toEqual({
      help: false,
      baseUrl: "https://env-online.example.com",
      allowedOrigin: "https://env-app.example.com",
      disallowedOrigin: "https://env-blocked.example",
      timeoutMs: 2000,
      allowLocalTarget: false,
    });
    expect(
      parseProbeArguments(
        ["--base-url", "https://cli-online.example.com"],
        environment,
      ),
    ).toMatchObject({ baseUrl: "https://cli-online.example.com" });
  });

  it.each([
    ["ONLINE_PROBE_BASE_URL", "--base-url"],
    ["ONLINE_PROBE_ALLOWED_ORIGIN", "--allowed-origin"],
    ["ONLINE_PROBE_DISALLOWED_ORIGIN", "--disallowed-origin"],
  ])("fails closed when required environment %s is empty", (key, option) => {
    expect(() =>
      parseProbeArguments([], {
        ONLINE_PROBE_BASE_URL: "https://online.example.com",
        ONLINE_PROBE_ALLOWED_ORIGIN: ALLOWED_ORIGIN,
        ONLINE_PROBE_DISALLOWED_ORIGIN: DISALLOWED_ORIGIN,
        [key]: "",
      }),
    ).toThrow(option);
  });

  it.each([
    [[], "--base-url is required"],
    [
      [
        "--base-url",
        "https://user:secret@online.example.com",
        "--allowed-origin",
        "https://app.example.com",
        "--disallowed-origin",
        "https://blocked.example",
      ],
      "must not contain credentials",
    ],
    [
      [
        "--base-url",
        "https://online.example.com/ws",
        "--allowed-origin",
        "https://app.example.com",
        "--disallowed-origin",
        "https://blocked.example",
      ],
      "without a path",
    ],
    [
      [
        "--base-url",
        "https://online.example.com",
        "--allowed-origin",
        "https://app.example.com",
        "--disallowed-origin",
        "https://app.example.com",
      ],
      "must be different",
    ],
    [
      [
        "--base-url",
        "https://*.online.example.com",
        "--allowed-origin",
        "https://app.example.com",
        "--disallowed-origin",
        "https://blocked.example",
      ],
      "wildcard host",
    ],
    [
      [
        "--base-url",
        "https://online.example.com",
        "--allowed-origin",
        "https://*.example.com",
        "--disallowed-origin",
        "https://blocked.example",
      ],
      "wildcard host",
    ],
    [
      [
        "--base-url",
        "https://online.example.com",
        "--allowed-origin",
        "https://app.example.com",
        "--disallowed-origin",
        "https://blocked.example",
        "--timeout-ms",
        "99",
      ],
      "must be between",
    ],
  ])("fails closed for invalid arguments %#", (args, message) => {
    expect(() => parseProbeArguments(args, {})).toThrow(message);
  });

  it.each([
    ["127.0.0.1", "loopback"],
    ["10.0.0.1", "private"],
    ["172.16.0.1", "private"],
    ["192.168.1.1", "private"],
    ["169.254.169.254", "link-local metadata"],
    ["[::1]", "loopback"],
    ["[fe80::1]", "link-local"],
    ["[fd00::1]", "private"],
    ["metadata.google.internal", "metadata hostname"],
  ])("rejects %s as a production probe target (%s)", (hostname) => {
    expect(() =>
      parseProbeArguments(
        [
          "--base-url",
          `https://${hostname}`,
          "--allowed-origin",
          "https://app.example.com",
          "--disallowed-origin",
          "https://blocked.example",
        ],
        {},
      ),
    ).toThrow("public");
  });

  it("allows only loopback targets through an explicit local-test opt-in", () => {
    expect(
      parseProbeArguments(
        [
          "--base-url",
          "http://127.0.0.1:4321",
          "--allowed-origin",
          "https://app.example.com",
          "--disallowed-origin",
          "https://blocked.example",
          "--allow-local-target",
        ],
        {},
      ),
    ).toMatchObject({
      baseUrl: "http://127.0.0.1:4321",
      allowLocalTarget: true,
    });
    expect(() =>
      parseProbeArguments(
        [
          "--base-url",
          "http://10.0.0.1",
          "--allowed-origin",
          "https://app.example.com",
          "--disallowed-origin",
          "https://blocked.example",
          "--allow-local-target",
        ],
        {},
      ),
    ).toThrow("only permits");
  });

  it("returns structured evidence when DNS resolution times out", async () => {
    const startedAt = Date.now();
    const evidence = await runBoundaryProbe({
      baseUrl: "https://online.example.com",
      allowedOrigin: "https://app.example.com",
      disallowedOrigin: "https://blocked.example",
      timeoutMs: 100,
      lookupFunction: (() =>
        new Promise(() => {})) as typeof import("node:dns/promises").lookup,
    });

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(evidence).toMatchObject({
      schemaVersion: 2,
      ok: false,
      target: { error: "dns_timeout" },
      checks: {
        health: { statusCode: null, error: "dns_timeout" },
        readiness: { statusCode: null, error: "dns_timeout" },
      },
    });
    expect(JSON.stringify(evidence)).not.toContain("stack");
  });

  it("returns structured evidence when DNS resolution fails", async () => {
    const evidence = await runBoundaryProbe({
      baseUrl: "https://online.example.com",
      allowedOrigin: "https://app.example.com",
      disallowedOrigin: "https://blocked.example",
      timeoutMs: 100,
      lookupFunction: (async () => {
        throw new Error("resolver-internal-detail");
      }) as typeof import("node:dns/promises").lookup,
    });

    expect(evidence).toMatchObject({
      ok: false,
      target: { error: "dns_lookup_failed" },
      checks: {
        health: { statusCode: null, error: "dns_lookup_failed" },
      },
    });
    expect(JSON.stringify(evidence)).not.toContain("resolver-internal-detail");
  });
});

describe("online boundary response body cleanup", () => {
  it("cancels a body when Content-Length is invalid before reader acquisition", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const getReader = vi.fn();
    const response = {
      headers: new Headers({ "content-length": "not-a-number" }),
      body: { cancel, getReader },
    };

    await expect(readBoundedResponseBody(response)).rejects.toMatchObject({
      code: "invalid_body_length",
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(getReader).not.toHaveBeenCalled();
  });

  it("cancels the body when getReader fails", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const response = {
      headers: new Headers(),
      body: {
        cancel,
        getReader: vi.fn(() => {
          throw new Error("reader unavailable");
        }),
      },
    };

    await expect(readBoundedResponseBody(response)).rejects.toThrow(
      "reader unavailable",
    );
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("cancels and releases the reader when a read fails", async () => {
    const reader = {
      read: vi.fn().mockRejectedValue(new Error("stream failed")),
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn(),
    };
    const response = {
      headers: new Headers(),
      body: { getReader: vi.fn(() => reader) },
    };

    await expect(readBoundedResponseBody(response)).rejects.toThrow(
      "stream failed",
    );
    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
  });

  it("cancels and releases the reader for oversized bodies", async () => {
    const reader = {
      read: vi
        .fn()
        .mockResolvedValue({ done: false, value: new Uint8Array(4_097) }),
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn(),
    };
    const response = {
      headers: new Headers(),
      body: { getReader: vi.fn(() => reader) },
    };

    await expect(readBoundedResponseBody(response)).rejects.toMatchObject({
      code: "body_too_large",
    });
    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
  });

  it("cancels and releases the reader for truncated bodies", async () => {
    const reader = {
      read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
      cancel: vi.fn().mockResolvedValue(undefined),
      releaseLock: vi.fn(),
    };
    const response = {
      headers: new Headers({ "content-length": "2" }),
      body: { getReader: vi.fn(() => reader) },
    };

    await expect(readBoundedResponseBody(response)).rejects.toMatchObject({
      code: "truncated_body",
    });
    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
  });
});

describe("online boundary probe", () => {
  it("applies exact Origin validation to programmatic probes", async () => {
    await expect(
      runBoundaryProbe({
        baseUrl: "https://online.example.com",
        allowedOrigin: "https://app.example.com/path",
        disallowedOrigin: DISALLOWED_ORIGIN,
      }),
    ).rejects.toThrow("--allowed-origin must be an exact HTTP(S) origin");

    await expect(
      runBoundaryProbe({
        baseUrl: "https://online.example.com",
        allowedOrigin: ALLOWED_ORIGIN,
        disallowedOrigin: ALLOWED_ORIGIN,
      }),
    ).rejects.toThrow("allowed and disallowed origins must be different");
  });

  it("checks liveness, readiness, and the exact 101/403/403 boundary without sending a frame", async () => {
    const fixture = await startBoundaryFixture();
    openFixtures.push(fixture);

    const evidence = await runBoundaryProbe({
      allowLocalTarget: true,
      baseUrl: fixture.baseUrl,
      allowedOrigin: ALLOWED_ORIGIN,
      disallowedOrigin: DISALLOWED_ORIGIN,
      timeoutMs: 1_000,
    });

    expect(evidence.schemaVersion).toBe(2);
    expect(evidence.ok).toBe(true);
    expect(evidence.checks.health).toMatchObject({
      statusCode: 200,
      body: { ok: true },
    });
    expect(
      "body" in evidence.checks.health
        ? evidence.checks.health.body
        : undefined,
    ).toEqual({ ok: true });
    expect(evidence.checks.readiness).toMatchObject({
      statusCode: 200,
      body: { ok: true },
    });
    expect(
      "body" in evidence.checks.readiness
        ? evidence.checks.readiness.body
        : undefined,
    ).toEqual({ ok: true });
    expect(evidence.checks.allowedOrigin.statusCode).toBe(101);
    expect(evidence.checks.disallowedOrigin.statusCode).toBe(403);
    expect(evidence.checks.missingOrigin.statusCode).toBe(403);
    expect(fixture.origins).toEqual([
      ALLOWED_ORIGIN,
      DISALLOWED_ORIGIN,
      undefined,
    ]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(Buffer.concat(fixture.applicationBytes)).toHaveLength(0);
  });

  it("accepts valid exact liveness and readiness JSON bodies", async () => {
    const fixture = await startBoundaryFixture({
      healthBody: '{"ok":true,"service":"four-bros-mahjong-online"}',
      readinessBody: '{"ok":true}',
    });
    openFixtures.push(fixture);

    const evidence = await runBoundaryProbe({
      allowLocalTarget: true,
      baseUrl: fixture.baseUrl,
      allowedOrigin: ALLOWED_ORIGIN,
      disallowedOrigin: DISALLOWED_ORIGIN,
      timeoutMs: 1_000,
    });

    expect(evidence.ok).toBe(true);
    expect(evidence.checks.health).toMatchObject({
      statusCode: 200,
      body: { ok: true },
    });
    expect(evidence.checks.readiness).toMatchObject({
      statusCode: 200,
      body: { ok: true },
    });
  });

  it("accepts all JSON whitespace characters around exact health fields", async () => {
    const fixture = await startBoundaryFixture({
      healthBody: `\r\n{\r\n\t"ok" \t:\t true,\r\n "service"\t:\t"${HEALTH_SERVICE}"\r\n}\r\n`,
      readinessBody: ` \r\n{\n\t"ok"\t:\ttrue\r\n}\t`,
    });
    openFixtures.push(fixture);

    const evidence = await runBoundaryProbe({
      allowLocalTarget: true,
      baseUrl: fixture.baseUrl,
      allowedOrigin: ALLOWED_ORIGIN,
      disallowedOrigin: DISALLOWED_ORIGIN,
      timeoutMs: 1_000,
    });

    expect(evidence.ok).toBe(true);
    expect(evidence.checks.health).toMatchObject({
      statusCode: 200,
      body: { ok: true },
    });
    expect(evidence.checks.readiness).toMatchObject({
      statusCode: 200,
      body: { ok: true },
    });
  });

  it("rejects duplicate keys in liveness JSON bodies", async () => {
    const fixture = await startBoundaryFixture({
      healthBody: '{"ok":false,"ok":true,"service":"four-bros-mahjong-online"}',
    });
    openFixtures.push(fixture);

    const evidence = await runBoundaryProbe({
      allowLocalTarget: true,
      baseUrl: fixture.baseUrl,
      allowedOrigin: ALLOWED_ORIGIN,
      disallowedOrigin: DISALLOWED_ORIGIN,
      timeoutMs: 1_000,
    });

    expect(evidence.ok).toBe(false);
    expect(evidence.checks.health).toMatchObject({
      statusCode: 200,
      error: "invalid_json",
    });
    expect(evidence.checks.health).not.toHaveProperty("body");
  });

  it("rejects duplicate keys in readiness JSON bodies", async () => {
    const fixture = await startBoundaryFixture({
      readinessBody: '{"ok":false,"ok":true}',
    });
    openFixtures.push(fixture);

    const evidence = await runBoundaryProbe({
      allowLocalTarget: true,
      baseUrl: fixture.baseUrl,
      allowedOrigin: ALLOWED_ORIGIN,
      disallowedOrigin: DISALLOWED_ORIGIN,
      timeoutMs: 1_000,
    });

    expect(evidence.ok).toBe(false);
    expect(evidence.checks.readiness).toMatchObject({
      statusCode: 200,
      error: "invalid_json",
    });
    expect(evidence.checks.readiness).not.toHaveProperty("body");
  });

  it("reports readiness drift separately from liveness", async () => {
    const fixture = await startBoundaryFixture({ readinessStatus: 503 });
    openFixtures.push(fixture);

    const evidence = await runBoundaryProbe({
      allowLocalTarget: true,
      baseUrl: fixture.baseUrl,
      allowedOrigin: ALLOWED_ORIGIN,
      disallowedOrigin: DISALLOWED_ORIGIN,
      timeoutMs: 1_000,
    });

    expect(evidence.ok).toBe(false);
    expect(evidence.checks.health.statusCode).toBe(200);
    expect(evidence.checks.readiness).toMatchObject({
      expectedStatus: 200,
      statusCode: 503,
      body: { ok: false },
    });
  });

  it.each([
    [
      "liveness",
      {
        healthBody: JSON.stringify({ ok: false, service: HEALTH_SERVICE }),
        readinessBody: undefined,
      },
    ],
    [
      "readiness",
      { healthBody: undefined, readinessBody: JSON.stringify({ ok: false }) },
    ],
  ])("rejects a 200 %s response with ok:false", async (_name, options) => {
    const fixture = await startBoundaryFixture(options);
    openFixtures.push(fixture);

    const evidence = await runBoundaryProbe({
      allowLocalTarget: true,
      baseUrl: fixture.baseUrl,
      allowedOrigin: ALLOWED_ORIGIN,
      disallowedOrigin: DISALLOWED_ORIGIN,
      timeoutMs: 1_000,
    });

    expect(evidence.schemaVersion).toBe(2);
    expect(evidence.ok).toBe(false);
    expect(evidence.checks.health).toMatchObject({
      body: options.healthBody === undefined ? { ok: true } : { ok: false },
    });
    expect(evidence.checks.readiness).toMatchObject({
      body: options.readinessBody === undefined ? { ok: true } : { ok: false },
    });
  });

  it.each([
    ["missing service", JSON.stringify({ ok: true })],
    ["wrong service", JSON.stringify({ ok: true, service: "another-service" })],
    [
      "unknown field",
      JSON.stringify({ ok: true, service: HEALTH_SERVICE, extra: "redact-me" }),
    ],
    ["nonboolean ok", JSON.stringify({ ok: "true", service: HEALTH_SERVICE })],
  ])("rejects invalid liveness payload: %s", async (_name, healthBody) => {
    const fixture = await startBoundaryFixture({ healthBody });
    openFixtures.push(fixture);

    const evidence = await runBoundaryProbe({
      allowLocalTarget: true,
      baseUrl: fixture.baseUrl,
      allowedOrigin: ALLOWED_ORIGIN,
      disallowedOrigin: DISALLOWED_ORIGIN,
      timeoutMs: 1_000,
    });

    expect(evidence.schemaVersion).toBe(2);
    expect(evidence.ok).toBe(false);
    expect(evidence.checks.health).toMatchObject({
      statusCode: 200,
      error: "invalid_schema",
    });
    expect(evidence.checks.health).not.toHaveProperty("body");
    expect(JSON.stringify(evidence)).not.toContain("redact-me");
  });

  it("rejects malformed liveness and readiness JSON while retaining status evidence", async () => {
    const fixture = await startBoundaryFixture({
      healthBody: "{malformed",
      readinessBody: "not-json",
    });
    openFixtures.push(fixture);

    const evidence = await runBoundaryProbe({
      allowLocalTarget: true,
      baseUrl: fixture.baseUrl,
      allowedOrigin: ALLOWED_ORIGIN,
      disallowedOrigin: DISALLOWED_ORIGIN,
      timeoutMs: 1_000,
    });

    expect(evidence.schemaVersion).toBe(2);
    expect(evidence.ok).toBe(false);
    expect(evidence.checks.health).toMatchObject({
      statusCode: 200,
      error: "invalid_json",
    });
    expect(evidence.checks.readiness).toMatchObject({
      statusCode: 200,
      error: "invalid_json",
    });
  });

  it("rejects unknown health fields without emitting their values", async () => {
    const secret = "health-secret-must-not-appear";
    const fixture = await startBoundaryFixture({
      healthBody: JSON.stringify({ ok: true, service: HEALTH_SERVICE, secret }),
    });
    openFixtures.push(fixture);

    const evidence = await runBoundaryProbe({
      allowLocalTarget: true,
      baseUrl: fixture.baseUrl,
      allowedOrigin: ALLOWED_ORIGIN,
      disallowedOrigin: DISALLOWED_ORIGIN,
      timeoutMs: 1_000,
    });

    expect(evidence.schemaVersion).toBe(2);
    expect(evidence.ok).toBe(false);
    expect(evidence.checks.health).toMatchObject({
      statusCode: 200,
      error: "invalid_schema",
    });
    expect(evidence.checks.health).not.toHaveProperty("body");
    expect(JSON.stringify(evidence)).not.toContain(secret);
  });

  it("rejects a nonboolean ok field without emitting the response object", async () => {
    const fixture = await startBoundaryFixture({
      readinessBody: JSON.stringify({ ok: "true" }),
    });
    openFixtures.push(fixture);

    const evidence = await runBoundaryProbe({
      allowLocalTarget: true,
      baseUrl: fixture.baseUrl,
      allowedOrigin: ALLOWED_ORIGIN,
      disallowedOrigin: DISALLOWED_ORIGIN,
      timeoutMs: 1_000,
    });

    expect(evidence.schemaVersion).toBe(2);
    expect(evidence.ok).toBe(false);
    expect(evidence.checks.readiness).toMatchObject({
      statusCode: 200,
      error: "invalid_schema",
    });
    expect(evidence.checks.readiness).not.toHaveProperty("body");
  });

  it("rejects oversized health bodies before they can enter evidence", async () => {
    const secret = "oversized-health-secret-must-not-appear";
    const fixture = await startBoundaryFixture({
      healthBody: JSON.stringify({
        ok: true,
        payload: "x".repeat(8_192),
        secret,
      }),
    });
    openFixtures.push(fixture);

    const evidence = await runBoundaryProbe({
      allowLocalTarget: true,
      baseUrl: fixture.baseUrl,
      allowedOrigin: ALLOWED_ORIGIN,
      disallowedOrigin: DISALLOWED_ORIGIN,
      timeoutMs: 1_000,
    });

    expect(evidence.schemaVersion).toBe(2);
    expect(evidence.ok).toBe(false);
    expect(evidence.checks.health).toMatchObject({
      statusCode: 200,
      error: "body_too_large",
    });
    expect(evidence.checks.health).not.toHaveProperty("body");
    expect(JSON.stringify(evidence)).not.toContain(secret);
  });

  it("reports drift and returns a non-zero CLI result", async () => {
    const fixture = await startBoundaryFixture({ allowMissingOrigin: true });
    openFixtures.push(fixture);
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const exitCode = await main([
      "--base-url",
      fixture.baseUrl,
      "--allowed-origin",
      ALLOWED_ORIGIN,
      "--disallowed-origin",
      DISALLOWED_ORIGIN,
      "--timeout-ms",
      "1000",
      "--allow-local-target",
    ]);

    expect(exitCode).toBe(1);
    const evidence = JSON.parse(String(output.mock.calls.at(-1)?.[0]));
    expect(evidence.schemaVersion).toBe(2);
    expect(evidence.ok).toBe(false);
    expect(evidence.checks.readiness.statusCode).toBe(200);
    expect(evidence.checks.missingOrigin).toMatchObject({
      expectedStatus: 403,
      statusCode: 101,
    });
  });

  it("bounds stalled handshakes and records timeout evidence", async () => {
    const fixture = await startBoundaryFixture({ hangUpgrades: true });
    openFixtures.push(fixture);

    const evidence = await runBoundaryProbe({
      allowLocalTarget: true,
      baseUrl: fixture.baseUrl,
      allowedOrigin: ALLOWED_ORIGIN,
      disallowedOrigin: DISALLOWED_ORIGIN,
      timeoutMs: 100,
    });

    expect(evidence.ok).toBe(false);
    expect(evidence.checks.allowedOrigin).toMatchObject({
      statusCode: null,
      error: "timeout",
    });
    expect(evidence.checks.disallowedOrigin).toMatchObject({
      statusCode: null,
      error: "timeout",
    });
    expect(evidence.checks.missingOrigin).toMatchObject({
      statusCode: null,
      error: "timeout",
    });
  });

  it("destroys a timed-out request transport before returning evidence", async () => {
    const transport = new EventEmitter() as ClientRequest;
    let capturedOptions: Record<string, unknown> | undefined;
    transport.end = vi.fn();
    transport.destroy = vi.fn();

    const evidence = await probeUpgrade(
      "https://online.example.com",
      ALLOWED_ORIGIN,
      100,
      (_target, options) => {
        capturedOptions = options;
        return transport;
      },
      {
        address: "198.51.100.10",
        family: 4,
        hostname: "online.example.com",
      },
    );

    expect(evidence).toMatchObject({ statusCode: null, error: "timeout" });
    expect(capturedOptions).toMatchObject({
      hostname: "198.51.100.10",
      servername: "online.example.com",
      headers: { Host: "online.example.com", Origin: ALLOWED_ORIGIN },
    });
    expect(capturedOptions?.lookup).toEqual(expect.any(Function));
    expect(transport.end).toHaveBeenCalledOnce();
    expect(transport.destroy).toHaveBeenCalledOnce();
    expect(transport.destroy).toHaveBeenCalledWith(expect.any(Error));
  });

  it("does not expose arbitrary upgrade error messages in evidence", async () => {
    const transport = new EventEmitter() as ClientRequest;
    const secret = "Authorization: Bearer probe-secret";
    transport.end = vi.fn(() => {
      transport.emit("error", new Error(secret));
      return transport;
    });

    const evidence = await probeUpgrade(
      "https://online.example.com",
      ALLOWED_ORIGIN,
      100,
      () => transport,
      {
        address: "198.51.100.10",
        family: 4,
        hostname: "online.example.com",
      },
    );

    expect(evidence).toMatchObject({
      statusCode: null,
      error: "request_failed",
    });
    expect(JSON.stringify(evidence)).not.toContain(secret);
  });
});
