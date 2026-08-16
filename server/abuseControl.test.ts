import { describe, expect, it } from "vitest";
import { ABUSE_LIMITS, OnlineAbuseControls } from "./abuseControl";

describe("online abuse controls", () => {
  it("bounds total and per-source connections with reservations", () => {
    let now = 0;
    const controls = new OnlineAbuseControls(() => now);
    for (let index = 0; index < ABUSE_LIMITS.maxConnections; index += 1) {
      expect(controls.admitConnection(`source-${index}`, index, 0)).toBeNull();
    }
    expect(
      controls.admitConnection(
        "another-source",
        ABUSE_LIMITS.maxConnections,
        0,
      ),
    ).toMatchObject({ code: "connection_limit" });

    for (let index = 0; index < ABUSE_LIMITS.maxConnections; index += 1)
      controls.releaseConnection(`source-${index}`);
    now += ABUSE_LIMITS.connectionAttempts.windowMs + 1;
    controls.cleanup();

    const source = "shared-household";
    for (
      let index = 0;
      index < ABUSE_LIMITS.maxConnectionsPerSource;
      index += 1
    )
      expect(controls.admitConnection(source, index, index)).toBeNull();
    expect(
      controls.admitConnection(
        source,
        ABUSE_LIMITS.maxConnectionsPerSource,
        ABUSE_LIMITS.maxConnectionsPerSource,
      ),
    ).toMatchObject({ code: "connection_limit" });
  });

  it("limits connection and room attempts with retryable scope codes", () => {
    let now = 0;
    const controls = new OnlineAbuseControls(() => now);
    for (
      let index = 0;
      index < ABUSE_LIMITS.connectionAttempts.limit;
      index += 1
    ) {
      expect(controls.admitConnection("source", 0, 0)).toBeNull();
      controls.releaseConnection("source");
    }
    expect(controls.admitConnection("source", 0, 0)).toMatchObject({
      code: "rate_limited",
      scope: "connection",
    });
    controls.releaseConnection("source");
    now += ABUSE_LIMITS.connectionAttempts.windowMs;
    expect(controls.admitConnection("source", 0, 0)).toBeNull();

    for (
      let index = 0;
      index < ABUSE_LIMITS.roomAttempts.create.limit;
      index += 1
    ) {
      expect(controls.consumeRoomAttempt("source", "create")).toBeNull();
    }
    expect(controls.consumeRoomAttempt("source", "create")).toMatchObject({
      code: "rate_limited",
      scope: "create",
    });
    now += ABUSE_LIMITS.roomAttempts.create.windowMs;
    expect(controls.consumeRoomAttempt("source", "create")).toBeNull();

    for (
      let index = 0;
      index < ABUSE_LIMITS.roomAttempts.join.limit;
      index += 1
    ) {
      expect(controls.consumeRoomAttempt("source", "join")).toBeNull();
    }
    expect(controls.consumeRoomAttempt("source", "join")).toMatchObject({
      code: "rate_limited",
      scope: "join",
    });
    for (
      let index = 0;
      index < ABUSE_LIMITS.roomAttempts.resume.limit;
      index += 1
    ) {
      expect(controls.consumeRoomAttempt("source", "resume")).toBeNull();
    }
    expect(controls.consumeRoomAttempt("source", "resume")).toMatchObject({
      code: "rate_limited",
      scope: "resume",
    });
  });

  it("limits messages and actions per socket without sharing a household bucket", () => {
    const controls = new OnlineAbuseControls(() => 0);
    const first = controls.createClientState();
    const second = controls.createClientState();
    for (let index = 0; index < ABUSE_LIMITS.messages.limit; index += 1)
      expect(controls.consumeMessage("source", first)).toBeNull();
    expect(controls.consumeMessage("source", first)).toMatchObject({
      code: "rate_limited",
      scope: "message",
    });
    expect(controls.consumeMessage("source", second)).toBeNull();

    for (let index = 0; index < ABUSE_LIMITS.actions.limit; index += 1)
      expect(controls.consumeAction("source", first)).toBeNull();
    expect(controls.consumeAction("source", first)).toMatchObject({
      code: "rate_limited",
      scope: "action",
    });

    const aggregate = new OnlineAbuseControls(() => 0);
    for (let index = 0; index < ABUSE_LIMITS.sourceMessages.limit; index += 1) {
      expect(
        aggregate.consumeMessage(
          "aggregate-source",
          aggregate.createClientState(),
        ),
      ).toBeNull();
    }
    expect(
      aggregate.consumeMessage(
        "aggregate-source",
        aggregate.createClientState(),
      ),
    ).toMatchObject({ code: "rate_limited", scope: "message" });

    for (let index = 0; index < ABUSE_LIMITS.sourceActions.limit; index += 1) {
      expect(
        aggregate.consumeAction(
          "aggregate-source",
          aggregate.createClientState(),
        ),
      ).toBeNull();
    }
    expect(
      aggregate.consumeAction(
        "aggregate-source",
        aggregate.createClientState(),
      ),
    ).toMatchObject({ code: "rate_limited", scope: "action" });
  });

  it("removes inactive source buckets after their windows expire", () => {
    let now = 0;
    const controls = new OnlineAbuseControls(() => now);
    expect(controls.admitConnection("source", 0, 0)).toBeNull();
    controls.releaseConnection("source");
    expect(controls.trackedSourceCount).toBe(1);
    now += 10 * 60 * 1_000 + 1;
    controls.cleanup();
    expect(controls.trackedSourceCount).toBe(0);
  });
});
