import { describe, expect, it } from "vitest";
import { BoundedMemo } from "./boundedMemo";

describe("BoundedMemo", () => {
  it("容量超過時は古い1件だけを退避し、全件clearしない", () => {
    const memo = new BoundedMemo<string, number>(3);
    memo.set("a", 1);
    memo.set("b", 2);
    memo.set("c", 3);
    memo.set("d", 4);

    expect(memo.size).toBe(3);
    expect(memo.get("a")).toBeUndefined();
    expect(memo.get("b")).toBe(2);
    expect(memo.get("c")).toBe(3);
    expect(memo.get("d")).toBe(4);
  });

  it("既存keyの更新では別entryを退避しない", () => {
    const memo = new BoundedMemo<string, number>(2);
    memo.set("a", 1);
    memo.set("b", 2);
    memo.set("a", 3);

    expect(memo.size).toBe(2);
    expect(memo.get("a")).toBe(3);
    expect(memo.get("b")).toBe(2);
  });

  it("undefinedもkeyとして扱い容量を維持する", () => {
    const memo = new BoundedMemo<string | undefined, number>(1);
    memo.set(undefined, 1);
    memo.set("next", 2);

    expect(memo.size).toBe(1);
    expect(memo.get(undefined)).toBeUndefined();
    expect(memo.get("next")).toBe(2);
  });

  it("不正な容量を拒否する", () => {
    expect(() => new BoundedMemo(0)).toThrow(RangeError);
    expect(() => new BoundedMemo(1.5)).toThrow(RangeError);
  });
});
