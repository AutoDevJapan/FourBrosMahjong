import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { DrainController } from "./drainController";
import { OpsBearerAuthenticator } from "./opsAuth";
import {
  handleOpsHttpRequest,
  ONLINE_OPS_DRAIN_PATH,
  ONLINE_OPS_STATUS_PATH,
  type OpsHttpDependencies,
} from "./opsHttp";
import { OpsAuthRateLimiter } from "./opsRateLimit";
import type { RoomManagerAggregateSnapshot } from "./roomManager";

const TOKEN = "A".repeat(32);

function aggregate(blockingDrainRooms = 1): RoomManagerAggregateSnapshot {
  return Object.freeze({
    webSocketConnections: 2,
    attachedSessionConnections: 1,
    pendingUpgrades: 0,
    retainedRooms: 1,
    connectedRooms: 1,
    blockingDrainRooms,
    reconnectGraceRooms: 0,
    completedConnectedRooms: 0,
    abandonedDuringDrainRooms: 0,
    uniqueConnectedSeats: 1,
  });
}

function controller(blockingDrainRooms = 1): DrainController {
  return new DrainController({
    monotonicNow: () => 5_000,
    currentConnections: () => aggregate(),
    currentAggregate: () => aggregate(blockingDrainRooms),
    beginDrainObservation: () => ({
      snapshot: () => aggregate(blockingDrainRooms),
    }),
  });
}

interface TestRequest {
  readonly value: IncomingMessage;
  readonly resume: ReturnType<typeof vi.fn>;
}

function testRequest(
  method: string,
  options: {
    readonly authorization?: string;
    readonly authorizationValues?: readonly string[];
    readonly headers?: Readonly<Record<string, string>>;
  } = {},
): TestRequest {
  const resume = vi.fn();
  return {
    resume,
    value: {
      method,
      headers: {
        ...(options.authorization === undefined
          ? {}
          : { authorization: options.authorization }),
        ...options.headers,
      },
      headersDistinct:
        options.authorizationValues === undefined
          ? undefined
          : { authorization: [...options.authorizationValues] },
      resume,
    } as unknown as IncomingMessage,
  };
}

interface TestResponse {
  readonly value: ServerResponse;
  readonly state: {
    status: number | null;
    headers: Readonly<Record<string, string>>;
    body: string;
    destroyed: boolean;
  };
}

function testResponse(): TestResponse {
  const state = {
    status: null as number | null,
    headers: {} as Readonly<Record<string, string>>,
    body: "",
    destroyed: false,
  };
  const response = {
    headersSent: false,
    writeHead(status: number, headers: Readonly<Record<string, string>>) {
      state.status = status;
      state.headers = headers;
      response.headersSent = true;
      return response;
    },
    end(body = "") {
      state.body = String(body);
      return response;
    },
    destroy() {
      state.destroyed = true;
      return response;
    },
  };
  return { value: response as unknown as ServerResponse, state };
}

function dependencies(
  overrides: Partial<OpsHttpDependencies> & {
    readonly drainController?: DrainController;
  } = {},
): OpsHttpDependencies & {
  readonly drainController: DrainController;
  readonly broadcastDrainStatus: ReturnType<typeof vi.fn>;
  readonly broadcastAccepting: ReturnType<typeof vi.fn>;
  readonly observeStatus: ReturnType<typeof vi.fn>;
} {
  const drainController = overrides.drainController ?? controller();
  return {
    routesAvailable: true,
    maintenanceNoticesEnabled: true,
    authenticator: new OpsBearerAuthenticator(TOKEN),
    rateLimiter: new OpsAuthRateLimiter(() => 1_000),
    drainController,
    startDrain: () => drainController.startDrain(),
    releaseDrain: () => drainController.releaseDrain(),
    maintenanceTimeline: () => ({ drainStartedAt: null, deadline: null }),
    reconnectGraceMs: 60_000,
    sourceRevision: "a".repeat(40),
    deploymentId: "deployment-fixture",
    replicaId: "replica-fixture",
    uptimeMs: () => 1_234,
    observedAtMs: () => Date.parse("2026-08-28T04:00:00.000Z"),
    sourceFor: () => "test-source",
    observeStatus: vi.fn(() => drainController.status()),
    broadcastDrainStatus: vi.fn(() => ({ sent: 2, skipped: 0, failed: 0 })),
    broadcastAccepting: vi.fn(() => ({ sent: 2, skipped: 0, failed: 0 })),
    ...overrides,
  } as OpsHttpDependencies & {
    readonly drainController: DrainController;
    readonly broadcastDrainStatus: ReturnType<typeof vi.fn>;
    readonly broadcastAccepting: ReturnType<typeof vi.fn>;
    readonly observeStatus: ReturnType<typeof vi.fn>;
  };
}

function invoke(
  path: string,
  method: string,
  deps: OpsHttpDependencies,
  requestOptions: Parameters<typeof testRequest>[1] = {
    authorization: `Bearer ${TOKEN}`,
    authorizationValues: [`Bearer ${TOKEN}`],
  },
) {
  const request = testRequest(method, requestOptions);
  const response = testResponse();
  const handled = handleOpsHttpRequest(
    request.value,
    response.value,
    path,
    deps,
  );
  return { handled, request, response };
}

describe("handleOpsHttpRequest", () => {
  it("returns only sanitized process identity in authenticated status", () => {
    const result = invoke(ONLINE_OPS_STATUS_PATH, "GET", dependencies());
    expect(result.response.state.status).toBe(200);
    expect(JSON.parse(result.response.state.body)).toMatchObject({
      sourceRevision: "a".repeat(40),
      deploymentId: "deployment-fixture",
      replicaId: "replica-fixture",
      observedAt: "2026-08-28T04:00:00.000Z",
    });

    const absent = invoke(
      ONLINE_OPS_STATUS_PATH,
      "GET",
      dependencies({ deploymentId: null, replicaId: null }),
    );
    expect(JSON.parse(absent.response.state.body)).toMatchObject({
      deploymentId: null,
      replicaId: null,
    });
  });

  it("leaves public paths alone and fails closed for unknown ops paths", () => {
    const deps = dependencies();
    expect(invoke("/healthz", "GET", deps).handled).toBe(false);

    const unknown = invoke("/ops/unknown", "GET", deps);
    expect(unknown.handled).toBe(true);
    expect(unknown.response.state.status).toBe(404);
    expect(unknown.response.state.headers).toMatchObject({
      "cache-control": "no-store",
      connection: "close",
    });
    expect(unknown.response.state.headers).not.toHaveProperty(
      "access-control-allow-origin",
    );
  });

  it("accepts exactly one Authorization value and rejects duplicates", () => {
    const deps = dependencies();
    const single = invoke(ONLINE_OPS_STATUS_PATH, "GET", deps);
    expect(single.response.state.status).toBe(200);

    const duplicate = invoke(ONLINE_OPS_STATUS_PATH, "GET", deps, {
      authorization: `Bearer ${TOKEN}`,
      authorizationValues: [`Bearer ${TOKEN}`, `Bearer ${TOKEN}`],
    });
    expect(duplicate.response.state.status).toBe(401);
  });

  it("rejects methods and bodies after authentication without CORS", () => {
    const deps = dependencies();
    const method = invoke(ONLINE_OPS_STATUS_PATH, "OPTIONS", deps);
    expect(method.response.state.status).toBe(405);
    expect(method.response.state.headers).toMatchObject({
      allow: "GET",
      connection: "close",
    });
    expect(method.response.state.headers).not.toHaveProperty(
      "access-control-allow-origin",
    );

    const body = invoke(ONLINE_OPS_DRAIN_PATH, "POST", deps, {
      authorization: `Bearer ${TOKEN}`,
      authorizationValues: [`Bearer ${TOKEN}`],
      headers: { "content-length": "1" },
    });
    expect(body.response.state.status).toBe(400);
    expect(body.request.resume).toHaveBeenCalledOnce();
    expect(deps.broadcastDrainStatus).not.toHaveBeenCalled();

    const mediaType = invoke(ONLINE_OPS_DRAIN_PATH, "POST", deps, {
      authorization: `Bearer ${TOKEN}`,
      authorizationValues: [`Bearer ${TOKEN}`],
      headers: { "content-type": "application/json" },
    });
    expect(mediaType.response.state.status).toBe(415);

    const chunked = invoke(ONLINE_OPS_DRAIN_PATH, "POST", deps, {
      authorization: `Bearer ${TOKEN}`,
      authorizationValues: [`Bearer ${TOKEN}`],
      headers: { "transfer-encoding": "chunked" },
    });
    expect(chunked.response.state.status).toBe(400);
    expect(deps.drainController.status().phase).toBe("accepting");
  });

  it("wires fixed auth rejection and same-source rate limiting", () => {
    const auth = dependencies();
    const missing = invoke(ONLINE_OPS_STATUS_PATH, "GET", auth, {});
    expect(missing.response.state.status).toBe(401);
    expect(missing.response.state.headers).not.toHaveProperty(
      "access-control-allow-origin",
    );
    const wrong = invoke(ONLINE_OPS_STATUS_PATH, "GET", auth, {
      authorization: `Bearer ${"B".repeat(32)}`,
      authorizationValues: [`Bearer ${"B".repeat(32)}`],
    });
    expect(wrong.response.state.status).toBe(401);
    expect(auth.drainController.status().phase).toBe("accepting");
    expect(auth.broadcastDrainStatus).not.toHaveBeenCalled();

    const limited = dependencies();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(
        invoke(ONLINE_OPS_STATUS_PATH, "GET", limited).response.state.status,
      ).toBe(200);
    }
    const eleventh = invoke(ONLINE_OPS_STATUS_PATH, "GET", limited);
    expect(eleventh.response.state.status).toBe(429);
    expect(eleventh.response.state.headers).toMatchObject({
      "cache-control": "no-store",
      connection: "close",
      "retry-after": "60",
    });
    expect(eleventh.response.state.headers).not.toHaveProperty(
      "access-control-allow-origin",
    );
    expect(limited.drainController.status().phase).toBe("accepting");
    expect(limited.broadcastDrainStatus).not.toHaveBeenCalled();
  });

  it("keeps mutation default-off and private routes unavailable", () => {
    const disabled = dependencies({ maintenanceNoticesEnabled: false });
    expect(
      invoke(ONLINE_OPS_DRAIN_PATH, "POST", disabled).response.state.status,
    ).toBe(409);
    expect(disabled.broadcastDrainStatus).not.toHaveBeenCalled();
    expect(disabled.drainController.status().phase).toBe("accepting");

    const unavailable = dependencies({ routesAvailable: false });
    expect(
      invoke(ONLINE_OPS_STATUS_PATH, "GET", unavailable).response.state.status,
    ).toBe(404);
  });

  it("starts once and releases atomically with one accepting broadcast", () => {
    const deps = dependencies();
    const started = invoke(ONLINE_OPS_DRAIN_PATH, "POST", deps);
    expect(started.response.state.status).toBe(200);
    expect(JSON.parse(started.response.state.body)).toMatchObject({
      phase: "draining",
      changed: true,
      drainStartedAt: null,
      deadline: null,
    });
    expect(JSON.parse(started.response.state.body)).not.toHaveProperty(
      "drainStartedMonotonicMs",
    );
    expect(deps.broadcastDrainStatus).toHaveBeenCalledOnce();

    const duplicateStart = invoke(ONLINE_OPS_DRAIN_PATH, "POST", deps);
    expect(JSON.parse(duplicateStart.response.state.body)).toMatchObject({
      phase: "draining",
      changed: false,
    });
    expect(deps.broadcastDrainStatus).toHaveBeenCalledOnce();

    const released = invoke(ONLINE_OPS_DRAIN_PATH, "DELETE", deps);
    expect(released.response.state.status).toBe(200);
    expect(JSON.parse(released.response.state.body)).toMatchObject({
      phase: "accepting",
      changed: true,
    });
    expect(deps.observeStatus).not.toHaveBeenCalled();
    expect(deps.broadcastAccepting).toHaveBeenCalledOnce();

    const duplicateRelease = invoke(ONLINE_OPS_DRAIN_PATH, "DELETE", deps);
    expect(duplicateRelease.response.state.status).toBe(409);
    expect(deps.broadcastAccepting).toHaveBeenCalledOnce();
  });

  it("never releases terminating and converts dependency faults to fixed 500", () => {
    const terminalController = controller();
    terminalController.beginTermination();
    const terminal = dependencies({ drainController: terminalController });
    expect(
      invoke(ONLINE_OPS_DRAIN_PATH, "DELETE", terminal).response.state.status,
    ).toBe(409);
    expect(terminal.broadcastAccepting).not.toHaveBeenCalled();

    const fault = dependencies({
      observeStatus: vi.fn(() => {
        throw new Error("private dependency detail");
      }),
    });
    const failed = invoke(ONLINE_OPS_STATUS_PATH, "GET", fault);
    expect(failed.response.state.status).toBe(500);
    expect(failed.response.state.body).toBe(
      JSON.stringify({ ok: false, error: "internal_error" }),
    );
    expect(failed.response.state.headers).not.toHaveProperty(
      "access-control-allow-origin",
    );
  });

  it("preflights uptime before mutation and documents at-most-once callback faults", () => {
    const preflightController = controller();
    const preflight = dependencies({
      drainController: preflightController,
      uptimeMs: () => Number.NaN,
    });
    expect(
      invoke(ONLINE_OPS_DRAIN_PATH, "POST", preflight).response.state.status,
    ).toBe(500);
    expect(preflightController.status().phase).toBe("accepting");
    expect(preflight.broadcastDrainStatus).not.toHaveBeenCalled();

    const committedController = controller();
    const committed = dependencies({
      drainController: committedController,
      broadcastDrainStatus: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error("injected callback fault");
        })
        .mockReturnValue({ sent: 0, skipped: 0, failed: 0 }),
    });
    expect(
      invoke(ONLINE_OPS_DRAIN_PATH, "POST", committed).response.state.status,
    ).toBe(500);
    expect(committedController.status().phase).toBe("draining");

    const retry = invoke(ONLINE_OPS_DRAIN_PATH, "POST", committed);
    expect(retry.response.state.status).toBe(200);
    expect(JSON.parse(retry.response.state.body)).toMatchObject({
      phase: "draining",
      changed: false,
      broadcast: null,
    });
    expect(committed.broadcastDrainStatus).toHaveBeenCalledOnce();

    const releaseController = controller();
    releaseController.startDrain();
    const release = dependencies({
      drainController: releaseController,
      broadcastAccepting: vi.fn(() => {
        throw new Error("injected accepting callback fault");
      }),
    });
    expect(
      invoke(ONLINE_OPS_DRAIN_PATH, "DELETE", release).response.state.status,
    ).toBe(500);
    expect(releaseController.status().phase).toBe("accepting");
    expect(
      invoke(ONLINE_OPS_DRAIN_PATH, "DELETE", release).response.state.status,
    ).toBe(409);
    expect(release.broadcastAccepting).toHaveBeenCalledOnce();
  });

  it("preflights the canonical wall observation before drain mutations", () => {
    const startController = controller();
    const startFault = dependencies({
      drainController: startController,
      observedAtMs: () => Number.NaN,
    });
    const start = invoke(ONLINE_OPS_DRAIN_PATH, "POST", startFault);
    expect(start.response.state.status).toBe(500);
    expect(start.response.state.body).not.toContain("NaN");
    expect(startController.status().phase).toBe("accepting");
    expect(startFault.broadcastDrainStatus).not.toHaveBeenCalled();

    const releaseController = controller();
    releaseController.startDrain();
    const releaseFault = dependencies({
      drainController: releaseController,
      observedAtMs: () => {
        throw new Error("private wall provider detail");
      },
    });
    const release = invoke(ONLINE_OPS_DRAIN_PATH, "DELETE", releaseFault);
    expect(release.response.state.status).toBe(500);
    expect(release.response.state.body).not.toContain("private wall");
    expect(releaseController.status().phase).toBe("draining");
    expect(releaseFault.broadcastAccepting).not.toHaveBeenCalled();

    const getFault = invoke(
      ONLINE_OPS_STATUS_PATH,
      "GET",
      dependencies({ observedAtMs: () => Number.POSITIVE_INFINITY }),
    );
    expect(getFault.response.state.status).toBe(500);
    expect(getFault.response.state.body).toBe(
      JSON.stringify({ ok: false, error: "internal_error" }),
    );
  });
});
