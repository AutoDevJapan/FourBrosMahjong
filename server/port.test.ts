import { describe, expect, it } from "vitest";
import {
  ONLINE_SERVER_PORT_DEFAULT,
  ONLINE_SERVER_PORT_MAX,
  ONLINE_SERVER_PORT_MIN,
  parseOnlineServerPort,
} from "./port";

describe("online server port parsing", () => {
  it("defaults only when the provider did not set PORT", () => {
    expect(parseOnlineServerPort(undefined)).toBe(ONLINE_SERVER_PORT_DEFAULT);
  });

  it("accepts strict decimal ports in the provider range", () => {
    expect(parseOnlineServerPort(String(ONLINE_SERVER_PORT_MIN))).toBe(
      ONLINE_SERVER_PORT_MIN,
    );
    expect(parseOnlineServerPort(String(ONLINE_SERVER_PORT_MAX))).toBe(
      ONLINE_SERVER_PORT_MAX,
    );
  });

  it.each(["", "0", "00", " 8080", "8080 ", "0x1f90", "8080.0", "1e3"])(
    "rejects non-canonical PORT=%j",
    (value) => {
      expect(() => parseOnlineServerPort(value)).toThrow(
        "PORT must be a decimal TCP port between 1 and 65535",
      );
    },
  );

  it.each(["65536", "999999999999999999999999999999"])(
    "rejects PORT outside the TCP range: %s",
    (value) => {
      expect(() => parseOnlineServerPort(value)).toThrow(
        "PORT must be a decimal TCP port between 1 and 65535",
      );
    },
  );
});
