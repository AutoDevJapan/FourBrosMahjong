import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import RulesPage from "./RulesPage";
import { RULE_SECTIONS } from "./rulesContent";

describe("RulesPage", () => {
  it("目次と共有URLのフラグメント対象へフォーカスを移せる", () => {
    const { container } = render(<RulesPage fontVariableClassName="" />);

    for (const section of RULE_SECTIONS) {
      expect(document.getElementById(section.id)).toHaveAttribute(
        "tabindex",
        "-1",
      );

      for (const item of section.items) {
        expect(document.getElementById(item.id)).toHaveAttribute(
          "tabindex",
          "-1",
        );
      }
    }

    expect(container.querySelectorAll("details[id^='rule-']")).toHaveLength(
      RULE_SECTIONS.length,
    );
  });
});
