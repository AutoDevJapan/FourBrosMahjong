import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Melds from "./Melds";
import type { MeldView } from "./types";

describe("Melds (副露の表示 / #97)", () => {
  it("副露が無いときは何も描画しない", () => {
    const { container } = render(<Melds melds={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("ポンは3枚すべて表向きで表示する", () => {
    const pon: MeldView = {
      type: "pon",
      tiles: [
        { suit: "sou", rank: 5, isRed: true },
        { suit: "sou", rank: 5 },
        { suit: "sou", rank: 5 },
      ],
      concealed: false,
    };
    render(<Melds melds={[pon]} />);
    // role クエリは暗黙ロールでも通るため、Safari/VoiceOver 対策の明示ロールは
    // 属性で回帰検証する(スペック5 5.2.5 / #270)。
    expect(screen.getByRole("list", { name: "副露" })).toHaveAttribute(
      "role",
      "list",
    );
    const group = screen.getByRole("listitem");
    expect(group).toHaveAccessibleName("ポン");
    // 3枚すべて内容が見える(伏せ牌ラベルは付かない)。
    expect(within(group).queryByLabelText("伏せ牌")).not.toBeInTheDocument();
    // 赤5索(赤ドラ)が含まれる。
    expect(within(group).getByLabelText(/赤ドラ/)).toBeInTheDocument();
  });

  it("暗槓は両端2枚を伏せ、内側2枚のみ開示する", () => {
    const ankan: MeldView = {
      type: "kan",
      tiles: [
        { suit: "man", rank: 9 },
        { suit: "man", rank: 9 },
        { suit: "man", rank: 9 },
        { suit: "man", rank: 9 },
      ],
      concealed: true,
    };
    render(<Melds melds={[ankan]} />);
    const group = screen.getByRole("listitem");
    expect(group).toHaveAccessibleName("暗槓");
    // 両端2枚が伏せ牌として描かれる。
    expect(within(group).getAllByLabelText("伏せ牌")).toHaveLength(2);
  });
});
