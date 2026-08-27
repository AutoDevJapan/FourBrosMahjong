import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Issue #712 Rules route style scope", () => {
  it("Rules固有styleをglobalへ載せず/rules routeだけから読む", () => {
    const globals = readFileSync("src/app/globals.css", "utf8");
    const rulesLayout = readFileSync("src/app/rules/layout.tsx", "utf8");
    const rulesStyles = readFileSync("src/app/rules/rules.css", "utf8");

    expect(globals).not.toContain(".rules-");
    expect(rulesLayout).toContain('import "./rules.css"');
    expect(rulesStyles).toContain(".rules-main");
    expect(rulesStyles).toContain(".rules-toc-column");
    expect(rulesStyles).toContain(".rules-section");
    expect(rulesStyles).toContain("var(--font-yuji-syuku)");
    expect(rulesStyles).toContain("font-synthesis: none");
    expect(rulesStyles).toContain("@media (forced-colors: active)");
  });
});
