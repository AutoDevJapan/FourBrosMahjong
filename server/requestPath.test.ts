import { describe, expect, it } from "vitest";
import { requestPath } from "./requestPath";

describe("requestPath", () => {
  it.each([
    { raw: undefined, expected: "/" },
    { raw: "/healthz?probe=1", expected: "/healthz" },
    { raw: "http://localhost/ws?room=ABC234", expected: "/ws" },
  ])("正当なrequest-targetからpathnameを返す: $raw", ({ raw, expected }) => {
    expect(requestPath(raw)).toBe(expected);
  });

  it("WHATWG URLとして不正なrequest-targetを例外にせず拒否する", () => {
    expect(() => requestPath("http://[")).not.toThrow();
    expect(requestPath("http://[")).toBeNull();
  });

  it.each(["//evil.example/ws", "//evil.example/ops/status"])(
    "network-path request-targetをlocal routeのaliasにしない: %s",
    (raw) => {
      expect(requestPath(raw)).toBeNull();
    },
  );

  it.each(["/\\evil.example/ws", "/foo\\..\\ws", "http:\\\\evil.example\\ws"])(
    "backslash request-targetをlocal routeのaliasにしない: %s",
    (raw) => {
      expect(requestPath(raw)).toBeNull();
    },
  );

  it.each([
    "/prefix/../ops/status",
    "/ops/./status",
    "/prefix/%2e%2e/ops/status",
    "/ops/%2E/status",
    "foo/../ops/status",
    "http://localhost/prefix/../ops/status",
    "http://localhost/%2e%2e/ops/status",
  ])(
    "dot-segment request-targetをlocal exact routeのaliasにしない: %s",
    (raw) => {
      expect(requestPath(raw)).toBeNull();
    },
  );

  it("does not inspect query or fragment text as pathname segments", () => {
    expect(requestPath("/ops/status?next=../healthz#ignored")).toBe(
      "/ops/status",
    );
  });
});
