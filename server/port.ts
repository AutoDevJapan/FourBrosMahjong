export const ONLINE_SERVER_PORT_DEFAULT = 8080;
export const ONLINE_SERVER_PORT_MIN = 1;
export const ONLINE_SERVER_PORT_MAX = 65_535;

const INVALID_PORT_MESSAGE =
  "PORT must be a decimal TCP port between 1 and 65535";

/**
 * Parse the provider-assigned listening port without accepting JavaScript's
 * permissive Number() forms (empty strings, whitespace, hex, or decimals).
 * Port 0 remains available through the explicit `listen(0)` test API, but is
 * never accepted from the deployment environment.
 */
export function parseOnlineServerPort(value: string | undefined): number {
  if (value === undefined) return ONLINE_SERVER_PORT_DEFAULT;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new RangeError(INVALID_PORT_MESSAGE);
  }

  const port = Number(value);
  if (
    !Number.isSafeInteger(port) ||
    port < ONLINE_SERVER_PORT_MIN ||
    port > ONLINE_SERVER_PORT_MAX
  ) {
    throw new RangeError(INVALID_PORT_MESSAGE);
  }
  return port;
}
