import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TileData } from "../game/types";
import Tile from "./Tile";

/** 牌面 SVG は背景画像として重ねる。`data-face` と inline style の双方で素材参照を検証する。 */
function expectFace(el: HTMLElement, name: string) {
  expect(el).toHaveAttribute("data-face", name);
  expect(el).toHaveStyle({
    backgroundImage: `url(/tiles/${name}.svg)`,
  });
}

describe("Tile", () => {
  it("数牌を SVG 牌面で描き、スート+数字の aria-label を出す(spec 5.2.1)", () => {
    const tile: TileData = { suit: "pin", rank: 5 };
    render(<Tile tile={tile} />);
    const el = screen.getByRole("img", { name: "五筒" });
    expect(el).toBeInTheDocument();
    expectFace(el, "Pin5");
  });

  it.each<[string, TileData, string]>([
    ["一萬", { suit: "man", rank: 1 }, "Man1"],
    ["九萬", { suit: "man", rank: 9 }, "Man9"],
    ["一索", { suit: "sou", rank: 1 }, "Sou1"],
    ["九筒", { suit: "pin", rank: 9 }, "Pin9"],
    ["東", { suit: "honor", rank: 1 }, "Ton"],
    ["南", { suit: "honor", rank: 2 }, "Nan"],
    ["西", { suit: "honor", rank: 3 }, "Shaa"],
    ["北", { suit: "honor", rank: 4 }, "Pei"],
    ["白", { suit: "honor", rank: 5 }, "Haku"],
    ["發", { suit: "honor", rank: 6 }, "Hatsu"],
    ["中", { suit: "honor", rank: 7 }, "Chun"],
  ])("%s を %s.svg で描く", (label, tile, face) => {
    render(<Tile tile={tile} />);
    expectFace(screen.getByRole("img", { name: label }), face);
  });

  it("赤ドラは色付き素材(*-Dora)+形状差(赤バッジ)+(赤ドラ)ラベルで差別化する", () => {
    const pin: TileData = { suit: "pin", rank: 5, isRed: true };
    render(<Tile tile={pin} />);
    const el = screen.getByRole("img", { name: "五筒(赤ドラ)" });
    expectFace(el, "Pin5-Dora");
    // 色のみに依存しない形状手がかり:「赤」バッジ。
    expect(el).toHaveTextContent("赤");
  });

  it("赤5索も -Dora 素材へ写像する", () => {
    const sou: TileData = { suit: "sou", rank: 5, isRed: true };
    render(<Tile tile={sou} />);
    expectFace(screen.getByRole("img", { name: "五索(赤ドラ)" }), "Sou5-Dora");
  });

  it("非赤の五筒/五索は通常素材のまま(色手がかりに依存しない)", () => {
    render(<Tile tile={{ suit: "sou", rank: 5 }} />);
    const el = screen.getByRole("img", { name: "五索" });
    expectFace(el, "Sou5");
    expect(el).not.toHaveTextContent("赤");
  });

  it("伏せ牌は裏面 SVG(Back)で描き 伏せ牌 とラベルする", () => {
    render(<Tile tile={null} />);
    const el = screen.getByRole("img", { name: "伏せ牌" });
    expectFace(el, "Back");
  });

  it("ラベル付き操作要素の内側では装飾扱い(aria-hidden・role なし)になる", () => {
    const tile: TileData = { suit: "man", rank: 1 };
    const { container } = render(<Tile tile={tile} decorative />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });
});
