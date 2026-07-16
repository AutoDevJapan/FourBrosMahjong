import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

/**
 * A throwaway component defined inline so this smoke test proves the component
 * testing harness end to end (jsdom render + Tailwind classes + state) without
 * depending on any real app component (those are owned by their own issues).
 */
function Toggle() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2 p-4">
      <button
        type="button"
        className="rounded-full bg-foreground px-4 py-2 text-background"
        onClick={() => setOpen((value) => !value)}
      >
        トグル
      </button>
      {open ? <p className="text-sm">開いています</p> : null}
    </div>
  );
}

describe("component testing harness (jsdom)", () => {
  it("renders a Tailwind-styled component into the jsdom document", () => {
    // The .tsx file runs in the jsdom project, so DOM globals exist.
    expect(typeof document).not.toBe("undefined");

    render(<Toggle />);

    const button = screen.getByRole("button", { name: "トグル" });
    // jest-dom matchers are available thanks to vitest.setup.ts.
    expect(button).toBeInTheDocument();
    // Tailwind v4 utility classes render onto the element as-is.
    expect(button).toHaveClass("rounded-full");
    expect(screen.queryByText("開いています")).not.toBeInTheDocument();
  });

  it("reflects user interaction via @testing-library/user-event", async () => {
    const user = userEvent.setup();
    render(<Toggle />);

    await user.click(screen.getByRole("button", { name: "トグル" }));

    expect(screen.getByText("開いています")).toBeInTheDocument();
  });
});
