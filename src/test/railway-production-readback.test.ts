import { describe, expect, it } from "vitest";
import {
  RAILWAY_PRODUCTION_READBACK_MAX_AGE_MS,
  RAILWAY_PRODUCTION_READBACK_MAX_FUTURE_SKEW_MS,
  validateRailwayProductionReadback,
} from "../../scripts/railwayProductionReadback";

const NOW = Date.parse("2026-09-06T02:00:00.000Z");
const SOURCE_REVISION = "a".repeat(40);

function iso(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

function readback() {
  return {
    schemaVersion: 1,
    capturedAt: iso(0),
    operator: {
      name: "production-operator",
      timezone: "Asia/Tokyo",
    },
    target: {
      projectId: "project-read-back",
      serviceId: "service-read-back",
      environmentId: "environment-production",
      deploymentId: "deployment-success",
      deploymentStatus: "success",
      sourceRevision: SOURCE_REVISION.toUpperCase(),
      publicBaseUrl: "https://online.example.com",
      healthcheckPath: "/readyz",
      port: 8080,
    },
    configuration: {
      allowedOrigin: "https://app.example.com",
    },
    reviewedSourceRevision: SOURCE_REVISION,
    probe: {
      schemaVersion: 2,
      ok: true,
      startedAt: iso(-4_000),
      finishedAt: iso(-1_000),
      baseUrl: "https://online.example.com",
      checks: {
        health: {
          expectedStatus: 200,
          startedAt: iso(-4_000),
          statusCode: 200,
          body: { ok: true },
        },
        readiness: {
          expectedStatus: 200,
          startedAt: iso(-3_000),
          statusCode: 200,
          body: { ok: true },
        },
        allowedOrigin: {
          origin: "https://app.example.com",
          expectedStatus: 101,
          startedAt: iso(-2_000),
          statusCode: 101,
        },
        disallowedOrigin: {
          origin: "https://blocked.example.com",
          expectedStatus: 403,
          startedAt: iso(-1_500),
          statusCode: 403,
        },
        missingOrigin: {
          expectedStatus: 403,
          startedAt: iso(-1_000),
          statusCode: 403,
        },
      },
    },
  };
}

describe("Railway production read-back contract (#980)", () => {
  it("passes a fresh exact-key sanitized read-back", () => {
    expect(validateRailwayProductionReadback(readback(), NOW)).toEqual({
      schemaVersion: 1,
      readback: "pass",
      authorizesDeployment: false,
      externalMutationPerformed: false,
      reasons: [],
    });
  });

  it("rejects extra fields so raw variables cannot be smuggled into evidence", () => {
    const candidate = readback() as Record<string, unknown>;
    candidate.unrelatedSecret = "do-not-reflect-this-value";

    const result = validateRailwayProductionReadback(candidate, NOW);

    expect(result.readback).toBe("hold");
    expect(result.reasons).toEqual(["invalid-schema"]);
    expect(JSON.stringify(result)).not.toContain("do-not-reflect-this-value");
  });

  it.each([
    [
      "stale",
      -RAILWAY_PRODUCTION_READBACK_MAX_AGE_MS - 1,
      "evidence-not-fresh",
    ],
    [
      "future",
      RAILWAY_PRODUCTION_READBACK_MAX_FUTURE_SKEW_MS + 1,
      "evidence-from-future",
    ],
  ] as const)("rejects %s capture timestamps", (_label, offsetMs, reason) => {
    const candidate = readback();
    candidate.capturedAt = new Date(NOW + offsetMs).toISOString();

    expect(validateRailwayProductionReadback(candidate, NOW).reasons).toContain(
      reason,
    );
  });

  it("rejects a deployment that does not match the reviewed full revision", () => {
    const candidate = readback();
    candidate.target.sourceRevision = "b".repeat(40);

    expect(validateRailwayProductionReadback(candidate, NOW).reasons).toContain(
      "source-revision-mismatch",
    );
  });

  it("rejects non-success deployment status, wrong healthcheck, and invalid port", () => {
    const candidate = readback();
    candidate.target.deploymentStatus = "building";
    candidate.target.healthcheckPath = "/healthz";
    candidate.target.port = 0;

    const reasons = validateRailwayProductionReadback(candidate, NOW).reasons;
    expect(reasons).toEqual(
      expect.arrayContaining([
        "deployment-not-successful",
        "healthcheck-mismatch",
        "port-invalid",
      ]),
    );
  });

  it("rejects probe drift even when the operator claims it passed", () => {
    const candidate = readback();
    candidate.probe.ok = true;
    candidate.probe.checks.missingOrigin.statusCode = 101;
    candidate.probe.checks.allowedOrigin.origin = "https://other.example.com";

    const reasons = validateRailwayProductionReadback(candidate, NOW).reasons;
    expect(reasons).toEqual(
      expect.arrayContaining(["probe-not-passing", "probe-origin-mismatch"]),
    );
  });

  it("rejects a probe captured after the top-level evidence timestamp", () => {
    const candidate = readback();
    candidate.probe.finishedAt = iso(1_000);

    expect(validateRailwayProductionReadback(candidate, NOW).reasons).toContain(
      "evidence-capture-skew",
    );
  });

  it("rejects non-public or non-canonical production origins", () => {
    const candidate = readback();
    candidate.target.publicBaseUrl = "http://localhost:8080/path";
    candidate.configuration.allowedOrigin = "https://*.example.com";

    const reasons = validateRailwayProductionReadback(candidate, NOW).reasons;
    expect(reasons).toEqual(
      expect.arrayContaining(["target-url-invalid", "allowed-origin-invalid"]),
    );
  });

  it("fails closed for malformed input without exposing its contents", () => {
    const secret = "authorization=Bearer top-secret";
    const result = validateRailwayProductionReadback({ secret }, NOW);

    expect(result).toEqual({
      schemaVersion: 1,
      readback: "hold",
      authorizesDeployment: false,
      externalMutationPerformed: false,
      reasons: ["invalid-schema"],
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
