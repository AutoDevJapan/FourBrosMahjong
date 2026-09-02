import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import EffectOverlay from "./EffectOverlay";
import type { ActiveGameEffect } from "./useGameEffects";

const effect: ActiveGameEffect = {
  eventId: 3,
  kind: "riichi",
  icon: "宣",
  title: "リーチ",
  detail: "粗悪品がリーチを宣言しました。",
  announcement: "粗悪品がリーチを宣言しました。",
  assertive: false,
  playerId: "p0",
};

describe("EffectOverlay", () => {
  it("演出を非操作・視覚補助として表示する", () => {
    render(<EffectOverlay effect={effect} />);

    const overlay = screen.getByTestId("effect-overlay");
    expect(overlay).toHaveAttribute("data-effect-type", "riichi");
    expect(overlay).toHaveAttribute("data-effect-id", "3");
    expect(overlay).toHaveAttribute("aria-hidden", "true");
    expect(overlay).toHaveClass("pointer-events-none");
    expect(overlay).toHaveTextContent("リーチ");
    expect(overlay.firstElementChild).toHaveClass("motion-reduce:animate-none");
  });

  it("effectが無ければDOMを追加しない", () => {
    const { container } = render(<EffectOverlay effect={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
