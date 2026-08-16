const LOCAL_DEVELOPMENT_WEBSOCKET_URL = "ws://localhost:8080/ws";

/**
 * Normalize the public WebSocket setting to the URL used by the browser.
 *
 * The same function is used by the CSP builder and the client connection code
 * so an endpoint cannot be allowed by one side and rejected by the other.
 */
export function normalizeOnlineWebSocketUrl(
  configuredUrl: string | undefined,
  development: boolean,
): string | null {
  const value =
    configuredUrl?.trim() ||
    (development ? LOCAL_DEVELOPMENT_WEBSOCKET_URL : "");
  if (!value) return null;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.username || parsed.password || parsed.hash) return null;

  const protocol =
    parsed.protocol === "http:"
      ? "ws:"
      : parsed.protocol === "https:"
        ? "wss:"
        : parsed.protocol === "ws:" || parsed.protocol === "wss:"
          ? parsed.protocol
          : null;
  if (!protocol) return null;
  // Production Vercel pages are HTTPS; do not turn a misconfigured insecure
  // endpoint into an allowed mixed-content WebSocket destination.
  if (!development && protocol === "ws:") return null;

  const path = parsed.pathname.replace(/\/+$/, "") || "";
  const endpointPath = path.endsWith("/ws") ? path : `${path}/ws`;

  return `${protocol}//${parsed.host}${endpointPath}${parsed.search}`;
}
