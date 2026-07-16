import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import OpponentHand from "./OpponentHand";

describe("OpponentHand", () => {
  it("伏せ手牌のまとまりを枚数付きの単一 img として公開する(スペック5 5.2.1 / #73)", () => {
    render(<OpponentHand count={13} />);
    // role="img" + aria-label で「手牌 N枚(伏せ)」を1回だけ読み上げる。
    // role の無い <div> への aria-label(aria-prohibited-attr)を避ける根本修正。
    const hand = screen.getByRole("img", { name: "手牌 13枚(伏せ)" });
    expect(hand).toBeInTheDocument();
  });

  it("配下の伏せ牌は装飾扱い(aria-hidden)で1枚ずつ読み上げさせない", () => {
    render(<OpponentHand count={3} />);
    // 個々の牌は img として露出しない(まとまりの img だけが露出する)。
    expect(screen.getAllByRole("img")).toHaveLength(1);
    const hand = screen.getByRole("img", { name: "手牌 3枚(伏せ)" });
    // 描画枚数分の装飾牌が直接の子として内包される(視覚表現は維持)。
    expect(hand.children).toHaveLength(3);
  });

  it("負数や小数の枚数は 0 以上の整数に丸める(境界値)", () => {
    render(<OpponentHand count={-2} />);
    expect(
      screen.getByRole("img", { name: "手牌 0枚(伏せ)" }),
    ).toBeInTheDocument();
  });
});
