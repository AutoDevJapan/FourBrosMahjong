import { describe, expect, it } from "vitest";
import {
  ONLINE_DRAIN_RECONNECT_GRACE_DEFAULT_MS,
  ONLINE_DRAIN_RECONNECT_GRACE_MAX_MS,
  ONLINE_DRAIN_RECONNECT_GRACE_MIN_MS,
  ONLINE_SHUTDOWN_GRACE_DEFAULT_MS,
  ONLINE_SHUTDOWN_GRACE_MAX_MS,
  ONLINE_SHUTDOWN_GRACE_MIN_MS,
  ONLINE_SOCKET_CLOSE_GRACE_DEFAULT_MS,
  ONLINE_SOCKET_CLOSE_GRACE_MAX_MS,
  ONLINE_SOCKET_CLOSE_GRACE_MIN_MS,
  readOnlineOpsConfiguration,
} from "./opsConfig";

const VALID_TOKEN = "A".repeat(32);
const REVISION_40 = "ABCDEF0123456789abcdef0123456789ABCDEF01";

describe("online ops configuration", () => {
  it("defaults optional ops and maintenance emission off", () => {
    const status = readOnlineOpsConfiguration({});

    expect(status).toMatchObject({
      valid: true,
      opsRoutesAvailable: false,
      readinessBlocked: false,
      errors: [],
      config: {
        required: false,
        maintenanceNoticesEnabled: false,
        authenticator: null,
        sourceRevision: null,
        reconnectGraceMs: ONLINE_DRAIN_RECONNECT_GRACE_DEFAULT_MS,
        shutdownGraceMs: ONLINE_SHUTDOWN_GRACE_DEFAULT_MS,
        socketCloseGraceMs: ONLINE_SOCKET_CLOSE_GRACE_DEFAULT_MS,
      },
    });
  });

  it("accepts required ops only with an authenticator and immutable revision", () => {
    const status = readOnlineOpsConfiguration({
      ONLINE_OPS_REQUIRED: "true",
      ONLINE_OPS_TOKEN: VALID_TOKEN,
      ONLINE_SOURCE_REVISION: REVISION_40,
      ONLINE_MAINTENANCE_NOTICES_ENABLED: "true",
      ONLINE_DRAIN_RECONNECT_GRACE_MS: String(
        ONLINE_DRAIN_RECONNECT_GRACE_MIN_MS,
      ),
      ONLINE_SHUTDOWN_GRACE_MS: String(ONLINE_SHUTDOWN_GRACE_MAX_MS),
      ONLINE_SOCKET_CLOSE_GRACE_MS: String(ONLINE_SOCKET_CLOSE_GRACE_MAX_MS),
    });

    expect(status.valid).toBe(true);
    expect(status.opsRoutesAvailable).toBe(true);
    expect(status.readinessBlocked).toBe(false);
    expect(status.config.maintenanceNoticesEnabled).toBe(true);
    expect(status.config.sourceRevision).toBe(REVISION_40.toLowerCase());
    expect(status.config.authenticator?.verify(`Bearer ${VALID_TOKEN}`)).toBe(
      true,
    );
  });

  it("blocks required readiness without a valid token and source revision", () => {
    const missing = readOnlineOpsConfiguration({
      ONLINE_OPS_REQUIRED: "true",
    });
    expect(missing.errors).toEqual([
      "missing-token",
      "missing-source-revision",
    ]);
    expect(missing.readinessBlocked).toBe(true);

    const invalid = readOnlineOpsConfiguration({
      ONLINE_OPS_REQUIRED: "true",
      ONLINE_OPS_TOKEN: "too-short",
      ONLINE_SOURCE_REVISION: "unknown",
    });
    expect(invalid.errors).toEqual([
      "invalid-token",
      "invalid-source-revision",
    ]);
    expect(invalid.config.authenticator).toBeNull();
    expect(invalid.config.sourceRevision).toBeNull();
    expect(invalid.readinessBlocked).toBe(true);
  });

  it("accepts only full 40- or 64-hex source revisions", () => {
    for (const revision of ["a".repeat(40), "B".repeat(64)]) {
      const status = readOnlineOpsConfiguration({
        ONLINE_SOURCE_REVISION: revision,
      });
      expect(status.valid).toBe(true);
      expect(status.config.sourceRevision).toBe(revision.toLowerCase());
    }

    for (const revision of [
      "unknown",
      "a".repeat(39),
      "a".repeat(41),
      "g".repeat(40),
      ` ${"a".repeat(40)}`,
    ]) {
      const status = readOnlineOpsConfiguration({
        ONLINE_SOURCE_REVISION: revision,
      });
      expect(status.errors).toContain("invalid-source-revision");
      expect(status.config.sourceRevision).toBeNull();
    }
  });

  it("strictly parses booleans and keeps the unsafe feature default off", () => {
    for (const invalidBoolean of ["TRUE", "1", "yes", " true ", ""]) {
      const status = readOnlineOpsConfiguration({
        ONLINE_OPS_REQUIRED: invalidBoolean,
        ONLINE_MAINTENANCE_NOTICES_ENABLED: invalidBoolean,
      });
      expect(status.config.required).toBe(false);
      expect(status.config.maintenanceNoticesEnabled).toBe(false);
      expect(status.errors).toEqual([
        "invalid-ops-required",
        "invalid-maintenance-notices-enabled",
      ]);
      expect(status.readinessBlocked).toBe(true);
    }
  });

  it("bounds all grace settings to safe decimal integers", () => {
    const boundaries = readOnlineOpsConfiguration({
      ONLINE_DRAIN_RECONNECT_GRACE_MS: String(
        ONLINE_DRAIN_RECONNECT_GRACE_MAX_MS,
      ),
      ONLINE_SHUTDOWN_GRACE_MS: String(ONLINE_SHUTDOWN_GRACE_MIN_MS + 1),
      ONLINE_SOCKET_CLOSE_GRACE_MS: String(ONLINE_SOCKET_CLOSE_GRACE_MIN_MS),
    });
    expect(boundaries.valid).toBe(true);

    const cases = [
      [
        "ONLINE_DRAIN_RECONNECT_GRACE_MS",
        String(ONLINE_DRAIN_RECONNECT_GRACE_MIN_MS - 1),
        "invalid-reconnect-grace",
      ],
      [
        "ONLINE_DRAIN_RECONNECT_GRACE_MS",
        String(ONLINE_DRAIN_RECONNECT_GRACE_MAX_MS + 1),
        "invalid-reconnect-grace",
      ],
      [
        "ONLINE_SHUTDOWN_GRACE_MS",
        String(ONLINE_SHUTDOWN_GRACE_MIN_MS - 1),
        "invalid-shutdown-grace",
      ],
      [
        "ONLINE_SHUTDOWN_GRACE_MS",
        String(ONLINE_SHUTDOWN_GRACE_MAX_MS + 1),
        "invalid-shutdown-grace",
      ],
      [
        "ONLINE_SOCKET_CLOSE_GRACE_MS",
        String(ONLINE_SOCKET_CLOSE_GRACE_MIN_MS - 1),
        "invalid-socket-close-grace",
      ],
      [
        "ONLINE_SOCKET_CLOSE_GRACE_MS",
        String(ONLINE_SOCKET_CLOSE_GRACE_MAX_MS + 1),
        "invalid-socket-close-grace",
      ],
      ["ONLINE_SHUTDOWN_GRACE_MS", "1e4", "invalid-shutdown-grace"],
      ["ONLINE_SHUTDOWN_GRACE_MS", "25000.5", "invalid-shutdown-grace"],
      ["ONLINE_SHUTDOWN_GRACE_MS", " 25000", "invalid-shutdown-grace"],
    ] as const;

    for (const [name, value, error] of cases) {
      const status = readOnlineOpsConfiguration({ [name]: value });
      expect(status.errors, `${name}=${value}`).toContain(error);
    }
  });

  it("requires the socket close sub-deadline to fit inside the total budget", () => {
    for (const [shutdown, socket] of [
      ["3000", "3000"],
      ["2999", "3000"],
    ]) {
      const status = readOnlineOpsConfiguration({
        ONLINE_SHUTDOWN_GRACE_MS: shutdown,
        ONLINE_SOCKET_CLOSE_GRACE_MS: socket,
      });
      expect(status.errors).toContain(
        "socket-close-grace-not-less-than-shutdown",
      );
    }
  });

  it("does not retain or serialize the raw token", () => {
    const status = readOnlineOpsConfiguration({
      ONLINE_OPS_TOKEN: VALID_TOKEN,
    });
    const serialized = JSON.stringify(status);

    expect(serialized).not.toContain(VALID_TOKEN);
    expect(serialized).not.toContain("expectedDigest");
    expect(status.config.authenticator?.verify(`Bearer ${VALID_TOKEN}`)).toBe(
      true,
    );
  });

  it("reports optional malformed settings without blocking public readiness", () => {
    const status = readOnlineOpsConfiguration({
      ONLINE_OPS_TOKEN: "short",
      ONLINE_SOURCE_REVISION: "unknown",
    });

    expect(status.valid).toBe(false);
    expect(status.opsRoutesAvailable).toBe(false);
    expect(status.readinessBlocked).toBe(false);
    expect(status.config.authenticator).toBeNull();
  });

  it("keeps ops routes unavailable when emission is enabled without auth", () => {
    const status = readOnlineOpsConfiguration({
      ONLINE_MAINTENANCE_NOTICES_ENABLED: "true",
    });

    expect(status.valid).toBe(true);
    expect(status.config.maintenanceNoticesEnabled).toBe(true);
    expect(status.config.authenticator).toBeNull();
    expect(status.opsRoutesAvailable).toBe(false);
    expect(status.readinessBlocked).toBe(false);
  });
});
