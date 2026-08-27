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
});
