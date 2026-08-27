/** Shared bounds for env parsing, RoomManager admission, and drain tests. */
export const ONLINE_DRAIN_RECONNECT_GRACE_MS = Object.freeze({
  default: 60_000,
  min: 15_000,
  max: 300_000,
});
