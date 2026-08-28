import { describe, expect, it, vi } from "vitest";
import { OnlineAbuseControls } from "./abuseControl";
import { admitUpgradeDuringDrain } from "./upgradeDrainAdmission";

describe("admitUpgradeDuringDrain", () => {
  it("rejects a terminal precheck without reserving", () => {
    const reserve = vi.fn();
    const rollback = vi.fn();
    expect(
      admitUpgradeDuringDrain({
        observePhase: () => "drained",
        reserve,
        rollback,
      }),
    ).toEqual({ outcome: "maintenance" });
    expect(reserve).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
  });

  it("rolls back exactly once when reservation reevaluation seals drain", () => {
    const abuse = new OnlineAbuseControls(() => 1_000);
    const source = "test-source";
    const pending = new Set(["upgrade"]);
    expect(abuse.admitConnection(source, 0, 0)).toBeNull();
    const rollback = vi.fn(() => {
      pending.delete("upgrade");
      abuse.releaseConnection(source);
    });
    expect(
      admitUpgradeDuringDrain({
        observePhase: () => "draining",
        reserve: () => ({ ok: true, phase: "drained" }),
        rollback,
      }),
    ).toEqual({ outcome: "maintenance" });
    expect(rollback).toHaveBeenCalledOnce();
    expect(pending.size).toBe(0);
    // The source bucket has all 32 slots again. Without releaseConnection the
    // final admission below would fail one attempt early.
    for (let index = 0; index < 32; index += 1) {
      expect(abuse.admitConnection(source, 0, 0)).toBeNull();
    }
    expect(abuse.admitConnection(source, 0, 0)).toMatchObject({
      code: "connection_limit",
    });
  });

  it("preserves reservation rejection and proceeds only while nonterminal", () => {
    const rejection = { code: "rate_limited" } as const;
    const rollback = vi.fn();
    expect(
      admitUpgradeDuringDrain({
        observePhase: () => "accepting",
        reserve: () => ({ ok: false, rejection }),
        rollback,
      }),
    ).toEqual({ outcome: "rejected", rejection });
    expect(rollback).not.toHaveBeenCalled();

    expect(
      admitUpgradeDuringDrain({
        observePhase: () => "draining",
        reserve: () => ({ ok: true, phase: "draining" }),
        rollback,
      }),
    ).toEqual({ outcome: "proceed" });
    expect(rollback).not.toHaveBeenCalled();
  });
});
