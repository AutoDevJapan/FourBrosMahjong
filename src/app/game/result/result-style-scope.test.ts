import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Issue #712 Result route style scope", () => {
  it("Result固有styleをglobalへ載せず/game/result routeだけから読む", () => {
    const globals = readFileSync("src/app/globals.css", "utf8");
    const resultLayout = readFileSync("src/app/game/result/layout.tsx", "utf8");
    const resultPage = readFileSync("src/app/game/result/page.tsx", "utf8");
    const resultStyles = readFileSync("src/app/game/result/result.css", "utf8");

    expect(globals).not.toContain(".result-");
    expect(resultLayout).toContain('import "./result.css"');
    expect(resultPage).toContain(
      'import { Yuji_Syuku } from "next/font/google"',
    );
    expect(resultPage).toContain('variable: "--font-yuji-syuku"');
    expect(resultPage).toContain('weight: "400"');
    expect(resultPage).toContain("preload: false");
    expect(resultStyles).toContain(".result-main");
    expect(resultStyles).toContain(".result-ranking-row--winner");
    expect(
      resultStyles
        .split("\n")
        .map((line) => line.trim())
        .filter(
          (line) =>
            line.startsWith(".result-") && !line.startsWith(".result-main"),
        ),
    ).toEqual([]);
    expect(resultStyles).toContain("var(--font-yuji-syuku)");
    expect(resultStyles).toContain("font-synthesis: none");
    expect(resultStyles).toContain("@media (forced-colors: active)");
    // フォーカスリングは globals.css の共通 :focus-visible と
    // --color-focus-ring に委譲し、結果画面だけ太さ・offsetを上書きしない。
    expect(resultStyles).not.toContain(":focus-visible");
  });
});
