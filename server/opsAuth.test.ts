import { describe, expect, it } from "vitest";
import {
  isValidOpsToken,
  ONLINE_OPS_AUTHORIZATION_MAX_BYTES,
  ONLINE_OPS_TOKEN_MAX_BYTES,
  ONLINE_OPS_TOKEN_MIN_BYTES,
  OpsBearerAuthenticator,
} from "./opsAuth";

const VALID_TOKEN = "A".repeat(ONLINE_OPS_TOKEN_MIN_BYTES);

describe("ops bearer authentication", () => {
  it("accepts a policy-compliant token and the case-insensitive bearer scheme", () => {
    const authenticator = new OpsBearerAuthenticator(VALID_TOKEN);

    expect(authenticator.verify(`Bearer ${VALID_TOKEN}`)).toBe(true);
    expect(authenticator.verify(`bearer ${VALID_TOKEN}`)).toBe(true);
  });

  it("rejects missing, duplicate, malformed, and wrong credentials", () => {
    const authenticator = new OpsBearerAuthenticator(VALID_TOKEN);

    expect(authenticator.verify(undefined)).toBe(false);
    expect(
      authenticator.verify([`Bearer ${VALID_TOKEN}`, `Bearer ${VALID_TOKEN}`]),
    ).toBe(false);
    expect(authenticator.verify(VALID_TOKEN)).toBe(false);
    expect(authenticator.verify(`Basic ${VALID_TOKEN}`)).toBe(false);
    expect(authenticator.verify(`Bearer  ${VALID_TOKEN}`)).toBe(false);
    expect(authenticator.verify(`Bearer ${VALID_TOKEN} `)).toBe(false);
    expect(authenticator.verify(`Bearer ${"B".repeat(32)}`)).toBe(false);
  });

  it("bounds the authorization input before digest comparison", () => {
    const authenticator = new OpsBearerAuthenticator(VALID_TOKEN);
    const oversized = `Bearer ${"A".repeat(ONLINE_OPS_TOKEN_MAX_BYTES + 1)}`;

    expect(Buffer.byteLength(oversized)).toBeGreaterThan(
      ONLINE_OPS_AUTHORIZATION_MAX_BYTES,
    );
    expect(authenticator.verify(oversized)).toBe(false);
  });

  it("enforces byte length and the unambiguous bearer-token alphabet", () => {
    expect(isValidOpsToken(VALID_TOKEN)).toBe(true);
    expect(isValidOpsToken(`${"A".repeat(31)}=`)).toBe(true);
    expect(isValidOpsToken("A".repeat(31))).toBe(false);
    expect(isValidOpsToken("é".repeat(16))).toBe(false);
    expect(isValidOpsToken("A".repeat(ONLINE_OPS_TOKEN_MAX_BYTES))).toBe(true);
    expect(isValidOpsToken("A".repeat(ONLINE_OPS_TOKEN_MAX_BYTES + 1))).toBe(
      false,
    );
    expect(isValidOpsToken(`${"A".repeat(31)} `)).toBe(false);
    expect(isValidOpsToken(`${"A".repeat(31)}\n`)).toBe(false);
  });

  it("throws a non-secret policy error instead of retaining invalid input", () => {
    const secret = "short-secret";

    expect(() => new OpsBearerAuthenticator(secret)).toThrow(
      "Ops token does not satisfy the security policy",
    );
    expect(() => new OpsBearerAuthenticator(secret)).not.toThrow(secret);
  });

  it("does not expose the configured token or its digest through serialization", () => {
    const authenticator = new OpsBearerAuthenticator(VALID_TOKEN);

    expect(JSON.stringify(authenticator)).toBe("{}");
    expect(Object.keys(authenticator)).toEqual([]);
  });
});
