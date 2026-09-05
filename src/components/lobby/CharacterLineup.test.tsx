import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CharacterLineup from "./CharacterLineup";

const EXPECTED_CHARACTERS = [
  ["p0", "粗悪品"],
  ["p1", "竜二"],
  ["p2", "マサキ"],
  ["p3", "糸瓜"],
] as const;

describe("CharacterLineup", () => {
  it("各キャラクターカードを可視名へ明示的に関連付ける", () => {
    const { container } = render(<CharacterLineup />);
    const lineup = screen.getByRole("region", { name: "四兄弟" });
    const cards = within(lineup).getAllByRole("article");

    expect(cards).toHaveLength(EXPECTED_CHARACTERS.length);
    const labelledBy = cards.map((card, index) => {
      const [, name] = EXPECTED_CHARACTERS[index];
      const heading = within(card).getByRole("heading", {
        level: 2,
        name,
      });
      const headingId = heading.getAttribute("id");

      expect(headingId).not.toBeNull();
      expect(card).toHaveAttribute("aria-labelledby", headingId);
      expect(document.getElementById(headingId ?? "")).toBe(heading);
      expect(within(lineup).getByRole("article", { name })).toBe(card);

      return headingId;
    });

    expect(new Set(labelledBy).size).toBe(EXPECTED_CHARACTERS.length);
    expect(container.querySelectorAll("article[aria-labelledby]")).toHaveLength(
      EXPECTED_CHARACTERS.length,
    );
  });
});
