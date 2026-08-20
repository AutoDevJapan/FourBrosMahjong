import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { connectionSource } from "./connectionSource";

function request(
  remoteAddress: string | undefined,
  xRealIp?: string | readonly string[],
): IncomingMessage {
  return {
    headers: xRealIp === undefined ? {} : { "x-real-ip": xRealIp },
    socket: { remoteAddress },
  } as unknown as IncomingMessage;
}

describe("online connection source", () => {
  it("uses Railways trusted client IP instead of grouping every user by the proxy", () => {
    expect(
      connectionSource(request("10.0.0.8", "203.0.113.42"), "production"),
    ).toBe("203.0.113.42");
  });

  it("ignores a spoofable X-Real-IP header outside Railway", () => {
    expect(
      connectionSource(request("192.0.2.10", "203.0.113.42"), undefined),
    ).toBe("192.0.2.10");
  });

  it("falls back to the peer address for malformed or duplicate proxy headers", () => {
    expect(
      connectionSource(request("192.0.2.10", "not-an-ip"), "production"),
    ).toBe("192.0.2.10");
    expect(
      connectionSource(
        request("192.0.2.10", ["203.0.113.42", "203.0.113.43"]),
        "production",
      ),
    ).toBe("192.0.2.10");
  });

  it("normalizes IPv4-mapped peer and Railway addresses", () => {
    expect(connectionSource(request("::ffff:192.0.2.10"), undefined)).toBe(
      "192.0.2.10",
    );
    expect(
      connectionSource(
        request("10.0.0.8", "::ffff:203.0.113.42"),
        "production",
      ),
    ).toBe("203.0.113.42");
  });

  it("uses a stable unknown bucket when no valid address is available", () => {
    expect(connectionSource(request(undefined), undefined)).toBe("unknown");
  });
});
