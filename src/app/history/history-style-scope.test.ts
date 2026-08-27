import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Issue #712 History route style scope", () => {
  it("History固有styleをglobalへ載せず/history routeだけから読む", () => {
    const globals = readFileSync("src/app/globals.css", "utf8");
    const historyLayout = readFileSync("src/app/history/layout.tsx", "utf8");
    const historyPage = readFileSync("src/app/history/page.tsx", "utf8");
    const historyStyles = readFileSync("src/app/history/history.css", "utf8");

    expect(globals).not.toContain(".history-");
    expect(historyLayout).toContain('import "./history.css"');
    expect(historyPage).toContain(
      'import { Yuji_Syuku } from "next/font/google"',
    );
    expect(historyPage).toContain('variable: "--font-yuji-syuku"');
    expect(historyPage).toContain('weight: "400"');
    expect(historyPage).toContain("preload: false");
    expect(historyStyles).toContain(".history-main");
    expect(historyStyles).not.toContain(".result-");
    expect(
      historyStyles
        .split("\n")
        .map((line) => line.trim())
        .filter(
          (line) =>
            line.startsWith(".history-") && !line.startsWith(".history-main"),
        ),
    ).toEqual([]);
    expect(historyStyles).toContain("var(--font-yuji-syuku)");
    expect(historyStyles).toContain("font-synthesis: none");
    expect(historyStyles).toContain("@media (forced-colors: active)");
  });
});
