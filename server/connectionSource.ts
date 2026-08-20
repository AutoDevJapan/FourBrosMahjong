import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";

function normalizedIp(value: string | undefined): string | null {
  if (value === undefined) return null;
  const address = value.trim();
  if (isIP(address) === 0) return null;
  return address.startsWith("::ffff:")
    ? address.slice("::ffff:".length)
    : address;
}

/**
 * Identify the source used by process-local abuse controls.
 *
 * Railway public networking terminates the client connection at its proxy and
 * supplies the original address in X-Real-IP. Trust that header only when the
 * Railway runtime marker is present; on local or direct deployments a caller
 * can forge the header, so the socket peer remains authoritative.
 *
 * @see https://docs.railway.com/networking/public-networking/specs-and-limits#technical-specifications
 */
export function connectionSource(
  request: IncomingMessage,
  railwayEnvironmentId = process.env.RAILWAY_ENVIRONMENT_ID,
): string {
  if (railwayEnvironmentId) {
    const forwardedAddress = request.headers["x-real-ip"];
    if (typeof forwardedAddress === "string") {
      const normalized = normalizedIp(forwardedAddress);
      if (normalized !== null) return normalized;
    }
  }

  return normalizedIp(request.socket.remoteAddress) ?? "unknown";
}
