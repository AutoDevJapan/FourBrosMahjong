import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LobbyPage from "@/components/lobby/LobbyPage";

function Home() {
  return <LobbyPage fontVariableClassName="test-yuji-variable" />;
}

const EXPECTED_CHARACTERS = [
  ["p0", "粗悪品", "/characters/p0-soakuhin-portrait.avif"],
  ["p1", "竜二", "/characters/p1-ryuji-portrait.avif"],
  ["p2", "マサキ", "/characters/p2-masaki-portrait.avif"],
  ["p3", "糸瓜", "/characters/p3-hechima-portrait.avif"],
] as const;

describe("Issue #712 Phase B1 ロビー", () => {
  it("#711の四兄弟をID順・正式名・公開用portraitで表示する", () => {
    render(<Home />);

    const lineup = screen.getByRole("region", { name: "四兄弟" });
    const cards = within(lineup).getAllByRole("article");
    expect(cards).toHaveLength(4);

    for (const [index, [id, name, src]] of EXPECTED_CHARACTERS.entries()) {
      expect(cards[index]).toHaveAttribute("data-character-id", id);
      expect(within(cards[index]).getByRole("heading", { name })).toBeVisible();
      const image = within(cards[index]).getByAltText("");
      expect(image).toHaveAttribute("src", src);
      expect(image).toHaveAttribute("loading", index === 0 ? "eager" : "lazy");
      expect(image).toHaveAttribute(
        "fetchpriority",
        index === 0 ? "high" : "auto",
      );
    }
  });

  it("primary・online・rules・history・settingsとfanmade表記を維持する", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", { level: 1, name: "四兄弟麻雀" }),
    ).toBeVisible();
    const menu = screen.getByRole("navigation", { name: "メインメニュー" });
    for (const [name, href] of [
      [/対局を始める/, "/game"],
      [/オンライン対戦/, "/online"],
      [/ルール説明/, "/rules"],
      [/戦績/, "/history"],
      [/設定/, "/settings"],
    ] as const) {
      expect(within(menu).getByRole("link", { name })).toHaveAttribute(
        "href",
        href,
      );
    }
    expect(screen.getByText(/非公式ファンメイド作品/)).toBeVisible();
  });

  it("reference注釈・固定席・未定義機能・reference PNGをruntimeへ持ち込まない", () => {
    const { container } = render(<Home />);

    for (const text of [
      "①",
      "ロビー（トップページ）",
      "お知らせ",
      "音量ON",
      "ver1.0.0",
      "東家",
      "南家",
      "西家",
      "北家",
      "あなた",
    ]) {
      expect(
        screen.queryByText(text, { exact: false }),
      ).not.toBeInTheDocument();
    }
    for (const image of container.querySelectorAll("img")) {
      expect(image.getAttribute("src")).not.toContain("ui-refresh");
      expect(image.getAttribute("src")).not.toContain("lobby.png");
    }
  });
});
