import { createHash, timingSafeEqual } from "node:crypto";

export const ONLINE_OPS_TOKEN_MIN_BYTES = 32;
export const ONLINE_OPS_TOKEN_MAX_BYTES = 1_024;
export const ONLINE_OPS_AUTHORIZATION_MAX_BYTES =
  "Bearer ".length + ONLINE_OPS_TOKEN_MAX_BYTES;

const INVALID_BEARER_CANDIDATE = "invalid";
const BEARER_TOKEN_PATTERN = /^[A-Za-z0-9\-._~+/]+=*$/;

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Validate the representation used for an ops token without retaining it.
 *
 * The token is intentionally limited to the RFC 6750 bearer-token alphabet.
 * This excludes whitespace/control characters that could make an HTTP header
 * ambiguous. Entropy cannot be inferred from a string, so deployment tooling
 * must still generate the value with a cryptographically secure RNG.
 */
export function isValidOpsToken(token: string): boolean {
  const byteLength = Buffer.byteLength(token, "utf8");
  return (
    byteLength >= ONLINE_OPS_TOKEN_MIN_BYTES &&
    byteLength <= ONLINE_OPS_TOKEN_MAX_BYTES &&
    BEARER_TOKEN_PATTERN.test(token)
  );
}

function bearerCandidate(
  authorization: string | readonly string[] | undefined,
): string {
  if (typeof authorization !== "string") return INVALID_BEARER_CANDIDATE;
  if (
    Buffer.byteLength(authorization, "utf8") >
    ONLINE_OPS_AUTHORIZATION_MAX_BYTES
  ) {
    return INVALID_BEARER_CANDIDATE;
  }

  const match = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/i.exec(authorization);
  if (match === null) return INVALID_BEARER_CANDIDATE;
  const token = match[1];
  if (Buffer.byteLength(token, "utf8") > ONLINE_OPS_TOKEN_MAX_BYTES) {
    return INVALID_BEARER_CANDIDATE;
  }
  return token;
}

/**
 * Constant-shape bearer verification for the private ops HTTP boundary.
 *
 * Every request, including missing, duplicate, malformed, oversized, and
 * incorrect headers, hashes one bounded candidate and performs one fixed-size
 * timing-safe comparison. The configured token and digest are private and are
 * therefore not exposed by JSON serialization or logging helpers.
 */
export class OpsBearerAuthenticator {
  readonly #expectedDigest: Buffer;

  constructor(token: string) {
    if (!isValidOpsToken(token)) {
      throw new TypeError("Ops token does not satisfy the security policy");
    }
    this.#expectedDigest = sha256(token);
  }

  verify(authorization: string | readonly string[] | undefined): boolean {
    const candidateDigest = sha256(bearerCandidate(authorization));
    return timingSafeEqual(candidateDigest, this.#expectedDigest);
  }
}
