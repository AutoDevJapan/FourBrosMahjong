import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HistoryPage from "./page";

describe("HistoryPage (/history)", () => {
  it("mainランドマークをページ見出しで識別できる", () => {
    render(<HistoryPage />);

    const heading = screen.getByRole("heading", {
      level: 1,
      name: "戦績",
    });
    const main = screen.getByRole("main", { name: "戦績" });

    expect(heading).toHaveAttribute("id", "history-page-title");
    expect(main).toHaveAttribute("aria-labelledby", "history-page-title");
  });
});
