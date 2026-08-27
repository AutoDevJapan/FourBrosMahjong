import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OKA,
  RETURN_POINTS,
  STARTING_POINTS,
} from "@/domain/scoring/settlement";

describe("ルール文書と精算定数の同期(#196)", () => {
  it("配給原点・返し・4人合計オカを実装値で明記する", () => {
    const rules = readFileSync(
      resolve(process.cwd(), "docs/四兄弟麻雀ルール.md"),
      "utf8",
    );

    expect(rules).toContain(`1人${STARTING_POINTS.toLocaleString("ja-JP")}点`);
    expect(rules).toContain(`${RETURN_POINTS.toLocaleString("ja-JP")}点返し`);
    expect(rules).toContain(`オカ${OKA.toLocaleString("ja-JP")}`);
    expect(OKA).toBe((RETURN_POINTS - STARTING_POINTS) * 4);
  });

  it("#708の任意北抜・CPU自動・リーチ後制約を正確に記録する", () => {
    const rules = readFileSync(
      resolve(process.cwd(), "docs/四兄弟麻雀ルール.md"),
      "utf8",
    );

    expect(rules).toContain("人間は自分の手番で北を任意に1枚ずつ抜いて");
    expect(rules).toContain("北を抜かずに打牌・保持してもよい");
    expect(rules).toContain("CPUは北を自動で抜く");
    expect(rules).toContain("リーチ後に抜けるのは、その手番でツモった北だけ");
    expect(rules).toContain("リーチ前から手牌にある北は抜けない");
  });
});
