import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import HandTileAnimation from "./HandTileAnimation";

describe("HandTileAnimation", () => {
  it("settles one stable animation key without changing option semantics", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        <HandTileAnimation
          animationKey="draw-1-2"
          animationKind="draw"
          role="option"
          aria-label="五筒"
        >
          牌
        </HandTileAnimation>,
      );
      const option = screen.getByRole("option", { name: "五筒" });

      expect(option).toHaveAttribute("data-hand-animation", "draw");
      expect(option).toHaveClass("opacity-0", "motion-reduce:opacity-100");
      expect(vi.getTimerCount()).toBe(1);

      rerender(
        <HandTileAnimation
          animationKey="draw-1-2"
          animationKind="draw"
          role="option"
          aria-label="五筒"
        >
          牌
        </HandTileAnimation>,
      );
      expect(vi.getTimerCount()).toBe(1);

      act(() => {
        vi.runAllTimers();
      });
      expect(option).toHaveClass("opacity-100");
      expect(option).not.toHaveClass("translate-y-1");
      expect(option).toHaveAttribute("data-hand-animation", "draw");
      expect(option).toHaveAttribute("role", "option");

      rerender(
        <HandTileAnimation role="option" aria-label="五筒">
          牌
        </HandTileAnimation>,
      );
      expect(option).not.toHaveAttribute("data-hand-animation");
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses a settling translation for melds and includes reduced-motion fallbacks", () => {
    const { container } = render(
      <HandTileAnimation animationKey="meld-1-0" animationKind="meld">
        牌
      </HandTileAnimation>,
    );
    const item = container.querySelector("li");
    expect(item).not.toBeNull();
    expect(item).toHaveAttribute("data-hand-animation", "meld");
    expect(item).toHaveClass(
      "opacity-80",
      "translate-x-1",
      "motion-reduce:transition-none",
      "motion-reduce:translate-x-0",
    );
  });

  it("removes deal staggering after the entrance transition", () => {
    vi.useFakeTimers();
    try {
      render(
        <HandTileAnimation
          animationKey="deal-1-3"
          animationKind="deal"
          animationDelayMs={60}
        >
          牌
        </HandTileAnimation>,
      );
      const item = screen.getByText("牌").closest("li");
      expect(item).not.toBeNull();
      expect(item).toHaveStyle({ transitionDelay: "60ms" });

      act(() => {
        vi.advanceTimersByTime(0);
      });
      expect(item).toHaveClass("opacity-100");
      expect(item).toHaveStyle({ transitionDelay: "60ms" });

      act(() => {
        vi.advanceTimersByTime(260);
      });
      expect(item).not.toHaveStyle({ transitionDelay: "60ms" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("timer登録がthrowしても牌を即時に確定する", () => {
    const setTimeout = vi.spyOn(window, "setTimeout").mockImplementation(() => {
      throw new Error("timer registration is unavailable");
    });

    try {
      render(
        <HandTileAnimation
          animationKey="deal-1-4"
          animationKind="deal"
          animationDelayMs={60}
        >
          牌
        </HandTileAnimation>,
      );
      const item = screen.getByText("牌").closest("li");

      expect(item).not.toBeNull();
      expect(item).toHaveClass("opacity-100");
      expect(item).not.toHaveClass("opacity-0", "translate-y-1");
      expect(item).not.toHaveStyle({ transitionDelay: "60ms" });
    } finally {
      setTimeout.mockRestore();
    }
  });

  it("timer cleanupがthrowしてもunmountを中断しない", () => {
    vi.useFakeTimers();
    const clearTimeout = vi
      .spyOn(window, "clearTimeout")
      .mockImplementation(() => {
        throw new Error("timer cleanup is unavailable");
      });

    try {
      const { unmount } = render(
        <HandTileAnimation
          animationKey="deal-1-5"
          animationKind="deal"
          animationDelayMs={60}
        >
          牌
        </HandTileAnimation>,
      );

      expect(() => unmount()).not.toThrow();
    } finally {
      clearTimeout.mockRestore();
      vi.useRealTimers();
    }
  });
});
