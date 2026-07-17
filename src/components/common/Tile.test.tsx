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

  it("伏せ牌は設計トークン由来の裏面(game-tile--back)で描き 伏せ牌 とラベルする(Issue #149)", () => {
    render(<Tile tile={null} />);
    const el = screen.getByRole("img", { name: "伏せ牌" });
    expect(el).toHaveAttribute("data-face", "Back");
    // 裏面はトークン由来 CSS で描くため、赤ベタの外部 SVG 背景画像は持たない。
    expect(el).toHaveClass("game-tile--back");
    expect(el).not.toHaveStyle({ backgroundImage: "url(/tiles/Back.svg)" });
  });

  it("ラベル付き操作要素の内側では装飾扱い(aria-hidden・role なし)になる", () => {
    const tile: TileData = { suit: "man", rank: 1 };
    const { container } = render(<Tile tile={tile} decorative />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  describe("カタログ外牌のフォールバック(issue #146)", () => {
    it.each<[string, TileData]>([
      ["五萬", { suit: "man", rank: 5 }], // サンマ非同梱の中張萬子
      ["二萬", { suit: "man", rank: 2 }],
      ["八萬", { suit: "man", rank: 8 }],
      ["字", { suit: "honor", rank: 8 }], // 旧実装は Back(裏面)誤描画
      ["字", { suit: "honor", rank: 0 }], // 旧実装は "" → /tiles/.svg で 404
    ])(
      "%s(%o)は牌名テキストの可視プレースホルダで描き、404・裏面・空白牌を出さない",
      (label, tile) => {
        render(<Tile tile={tile} />);
        const el = screen.getByRole("img", { name: label });
        // background-image を発行しない(404 リスク回避・onError 不能問題の回避)。
        expect(el.style.backgroundImage).toBe("");
        // 表向き牌に裏面(Back)を描かず、fallback と識別できる。
        expect(el).toHaveAttribute("data-face", "fallback");
        // 視覚(牌名テキスト)と aria-label が一致する(空白牌にならない)。
        expect(el).toHaveTextContent(label);
      },
    );

    it("赤5萬(素材なし)は fallback で描き、赤バッジも (赤ドラ) ラベルも付さない", () => {
      render(<Tile tile={{ suit: "man", rank: 5, isRed: true }} />);
      // 赤扱いは発火しないため aria-label は「五萬」(赤ドラ無し)。
      const el = screen.getByRole("img", { name: "五萬" });
      expect(el).toHaveAttribute("data-face", "fallback");
      expect(el).not.toHaveTextContent("赤");
      expect(el).not.toHaveTextContent("ドラ");
    });
  });

  describe("isRed 非整合の整合方針(issue #146)", () => {
    it("赤フラグ付き3筒(非5)は通常牌として描く: 牌面・バッジ・ラベルが整合", () => {
      render(<Tile tile={{ suit: "pin", rank: 3, isRed: true }} />);
      // 赤扱いを発火させない → ラベルは「三筒」(赤ドラ無し)、赤バッジ無し、通常素材。
      const el = screen.getByRole("img", { name: "三筒" });
      expectFace(el, "Pin3");
      expect(el).not.toHaveTextContent("赤");
    });
  });
});
