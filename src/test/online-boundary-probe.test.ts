import { EventEmitter } from "node:events";
import type { ClientRequest } from "node:http";
import { createServer, type Server } from "node:http";
import type { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  main,
  parseProbeArguments,
  probeUpgrade,
  runBoundaryProbe,
} from "../../scripts/probe-online-boundary.mjs";

const ALLOWED_ORIGIN = "http://allowed.local";
const DISALLOWED_ORIGIN = "http://disallowed.local";

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
  healthBody = JSON.stringify({ ok: true }),
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
        ONLINE_PROBE_BASE_URL: "http://online.local",
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
});

describe("online boundary probe", () => {
  it("checks liveness, readiness, and the exact 101/403/403 boundary without sending a frame", async () => {
    const fixture = await startBoundaryFixture();
    openFixtures.push(fixture);

    const evidence = await runBoundaryProbe({
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
    expect(evidence.checks.readiness).toMatchObject({
      statusCode: 200,
      body: { ok: true },
    });
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

  it("reports readiness drift separately from liveness", async () => {
    const fixture = await startBoundaryFixture({ readinessStatus: 503 });
    openFixtures.push(fixture);

    const evidence = await runBoundaryProbe({
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
      { healthBody: JSON.stringify({ ok: false }), readinessBody: undefined },
    ],
    [
      "readiness",
      { healthBody: undefined, readinessBody: JSON.stringify({ ok: false }) },
    ],
  ])("rejects a 200 %s response with ok:false", async (_name, options) => {
    const fixture = await startBoundaryFixture(options);
    openFixtures.push(fixture);

    const evidence = await runBoundaryProbe({
      baseUrl: fixture.baseUrl,
      allowedOrigin: ALLOWED_ORIGIN,
      disallowedOrigin: DISALLOWED_ORIGIN,
      timeoutMs: 1_000,
    });

    expect(evidence.schemaVersion).toBe(2);
    expect(evidence.ok).toBe(false);
    expect(evidence.checks.health.body).toEqual(
      options.healthBody === undefined ? { ok: true } : { ok: false },
    );
    expect(evidence.checks.readiness.body).toEqual(
      options.readinessBody === undefined ? { ok: true } : { ok: false },
    );
  });

  it("rejects malformed liveness and readiness JSON while retaining status evidence", async () => {
    const fixture = await startBoundaryFixture({
      healthBody: "{malformed",
      readinessBody: "not-json",
    });
    openFixtures.push(fixture);

    const evidence = await runBoundaryProbe({
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
    transport.end = vi.fn();
    transport.destroy = vi.fn();

    const evidence = await probeUpgrade(
      "http://online.local",
      ALLOWED_ORIGIN,
      100,
      () => transport,
    );

    expect(evidence).toMatchObject({ statusCode: null, error: "timeout" });
    expect(transport.end).toHaveBeenCalledOnce();
    expect(transport.destroy).toHaveBeenCalledOnce();
    expect(transport.destroy).toHaveBeenCalledWith(expect.any(Error));
  });
});
