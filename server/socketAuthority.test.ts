import { describe, expect, it, vi } from "vitest";
import {
  isAuthoritativeConnection,
  supersedeConnection,
} from "./socketAuthority";

describe("socket replacement authority", () => {
  it("revokes message, pong, and notification authority before close", () => {
    const stale = { superseded: false };
    const close = vi.fn(() => {
      expect(isAuthoritativeConnection(stale)).toBe(false);
    });
    supersedeConnection(stale, close);
    expect(close).toHaveBeenCalledOnce();
    expect(isAuthoritativeConnection(stale)).toBe(false);
  });
});
