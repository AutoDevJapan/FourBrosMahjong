import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import {
  MAX_MAINTENANCE_RETRY_AFTER_MS as CLIENT_MAX_MAINTENANCE_RETRY_AFTER_MS,
  parseOnlineServerMessage,
} from "../src/components/online/onlineServerMessage";
import {
  broadcastMaintenanceNotice,
  closeSocketForMaintenance,
  createMaintenanceAcceptingNotice,
  createMaintenanceNotice,
  MAINTENANCE_CLOSE_CODE,
  MAINTENANCE_CLOSE_REASON,
  MAX_MAINTENANCE_RETRY_AFTER_MS,
  type MaintenanceProtocolSocket,
} from "./maintenanceProtocol";

function socket(readyState = 1): MaintenanceProtocolSocket {
  return {
    readyState,
    send: vi.fn(),
    close: vi.fn(),
  };
}

describe("maintenance protocol payload", () => {
  it.each(["draining", "drained", "terminating"] as const)(
    "creates an exact %s notice accepted by the deployed client parser",
    (phase) => {
      const message = createMaintenanceNotice(phase);

      expect(message).toEqual({ type: "maintenance", phase });
      expect(Object.keys(message)).toEqual(["type", "phase"]);
      expect(parseOnlineServerMessage(message)).toEqual(message);
    },
  );

  it("fails closed for a phase outside the server emission contract", () => {
    expect(() =>
      createMaintenanceNotice("accepting" as unknown as "draining"),
    ).toThrow(TypeError);
  });

  it("includes only bounded retry timing and a server-generated ISO deadline", () => {
    expect(MAX_MAINTENANCE_RETRY_AFTER_MS).toBe(
      CLIENT_MAX_MAINTENANCE_RETRY_AFTER_MS,
    );
    const deadline = new Date("2026-08-28T06:00:00.123Z");
    const message = createMaintenanceNotice("draining", {
      retryAfterMs: MAX_MAINTENANCE_RETRY_AFTER_MS,
      deadline,
    });

    expect(message).toEqual({
      type: "maintenance",
      phase: "draining",
      retryAfterMs: 600_000,
      deadline: "2026-08-28T06:00:00.123Z",
    });
    expect(parseOnlineServerMessage(message)).toEqual(message);
  });

  it.each([
    -1,
    0.5,
    MAX_MAINTENANCE_RETRY_AFTER_MS + 1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])("fails closed for an invalid retryAfterMs: %s", (retryAfterMs) => {
    expect(() => createMaintenanceNotice("draining", { retryAfterMs })).toThrow(
      RangeError,
    );
  });

  it("accepts both retry boundaries", () => {
    expect(createMaintenanceNotice("draining", { retryAfterMs: 0 })).toEqual({
      type: "maintenance",
      phase: "draining",
      retryAfterMs: 0,
    });
    expect(
      createMaintenanceNotice("terminating", {
        retryAfterMs: MAX_MAINTENANCE_RETRY_AFTER_MS,
      }),
    ).toEqual({
      type: "maintenance",
      phase: "terminating",
      retryAfterMs: 600_000,
    });
  });

  it("fails closed for invalid or non-Date deadlines", () => {
    expect(() =>
      createMaintenanceNotice("draining", { deadline: new Date(Number.NaN) }),
    ).toThrow(RangeError);
    expect(() =>
      createMaintenanceNotice("draining", {
        deadline: "2026-08-28T06:00:00.000Z" as unknown as Date,
      }),
    ).toThrow(TypeError);
  });

  it.each([-1, 10_000])(
    "rejects extended ISO year %s that the client parser cannot consume",
    (year) => {
      const deadline = new Date(0);
      deadline.setUTCFullYear(year);
      const serializedDeadline = deadline.toISOString();

      expect(
        parseOnlineServerMessage({
          type: "maintenance",
          phase: "draining",
          deadline: serializedDeadline,
        }),
      ).toBeNull();
      expect(() => createMaintenanceNotice("draining", { deadline })).toThrow(
        RangeError,
      );
    },
  );

  it.each([0, 9_999])(
    "round-trips the client-compatible four-digit ISO year boundary %s",
    (year) => {
      const deadline = new Date(0);
      deadline.setUTCFullYear(year);
      const message = createMaintenanceNotice("terminating", { deadline });

      expect(parseOnlineServerMessage(message)).toEqual(message);
    },
  );

  it("creates exact accepting without stale timing or arbitrary fields", () => {
    const message = createMaintenanceAcceptingNotice();

    expect(message).toEqual({ type: "maintenance", phase: "accepting" });
    expect(Object.keys(message)).toEqual(["type", "phase"]);
    expect(parseOnlineServerMessage(message)).toEqual(message);
  });

  it("does not copy PII, credentials, secrets, or operator wording", () => {
    const timing = {
      retryAfterMs: 1_000,
      deadline: new Date("2026-08-28T06:00:00.000Z"),
      roomCode: "ABC234",
      playerName: "利用者名",
      resumeToken: "secret-token",
      operatorMessage: "任意文言",
    };

    const serialized = JSON.stringify(
      createMaintenanceNotice("draining", timing),
    );

    expect(serialized).toBe(
      '{"type":"maintenance","phase":"draining","retryAfterMs":1000,"deadline":"2026-08-28T06:00:00.000Z"}',
    );
    expect(serialized).not.toMatch(/ABC234|利用者名|secret-token|任意文言/u);
  });
});

describe("maintenance protocol socket helpers", () => {
  it("sends to every OPEN socket and isolates one synchronous send failure", () => {
    const first = socket();
    const broken = socket();
    const last = socket();
    const closed = socket(3);
    vi.mocked(broken.send).mockImplementation(() => {
      throw new Error("token-like details must not escape");
    });
    const message = createMaintenanceNotice("drained", {
      retryAfterMs: 2_000,
    });

    const result = broadcastMaintenanceNotice(
      [first, broken, closed, last],
      message,
    );

    const data = JSON.stringify(message);
    expect(first.send).toHaveBeenCalledWith(data);
    expect(last.send).toHaveBeenCalledWith(data);
    expect(closed.send).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 2, skipped: 1, failed: 1 });
    expect(Object.keys(result)).toEqual(["sent", "skipped", "failed"]);
  });

  it("uses the fixed ASCII RFC 6455 service-restart close contract", () => {
    expect(MAINTENANCE_CLOSE_CODE).toBe(1012);
    expect(MAINTENANCE_CLOSE_REASON).toBe("service restart");
    expect(MAINTENANCE_CLOSE_REASON).toMatch(/^[\x20-\x7e]+$/u);
    expect(
      Buffer.byteLength(MAINTENANCE_CLOSE_REASON, "utf8"),
    ).toBeLessThanOrEqual(123);
    const open = socket();

    expect(closeSocketForMaintenance(open)).toBe(true);
    expect(open.close).toHaveBeenCalledWith(1012, "service restart");
  });

  it("skips non-OPEN sockets and contains close failures", () => {
    const closed = socket(3);
    const broken = socket();
    vi.mocked(broken.close).mockImplementation(() => {
      throw new Error("closed concurrently");
    });

    expect(closeSocketForMaintenance(closed)).toBe(false);
    expect(closed.close).not.toHaveBeenCalled();
    expect(closeSocketForMaintenance(broken)).toBe(false);
  });
});
