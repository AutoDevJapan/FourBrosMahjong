import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import KitaDisplay from "./KitaDisplay";

describe("KitaDisplay", () => {
  it.each([1, 2, 4])("ガリ%d枚を公開牌と枚数で表示する", (count) => {
    const { container } = render(<KitaDisplay count={count} />);

    const display = screen.getByTestId("kita-display");
    expect(display).toHaveTextContent(`抜き北 ガリ${count}枚`);
    expect(display).not.toHaveAttribute("aria-label");
    expect(container.querySelectorAll('[data-face="Pei"]')).toHaveLength(count);
  });

  it("0枚では表示せず、compactでは枚数を残して牌を省略する", () => {
    const { rerender, container } = render(<KitaDisplay count={0} />);
    expect(screen.queryByTestId("kita-display")).not.toBeInTheDocument();

    rerender(<KitaDisplay count={2} compact />);
    expect(screen.getByText("ガリ2")).toBeInTheDocument();
    expect(container.querySelector('[data-face="Pei"]')).toBeNull();
  });
});
