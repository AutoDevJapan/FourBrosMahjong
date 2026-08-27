import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import GameGlossary, { GAME_GLOSSARY } from "./GameGlossary";

describe("GameGlossary (#610)", () => {
  it("主要用語をキーボードで開いて確認でき、Escapeで入口へ戻る", async () => {
    const user = userEvent.setup();
    render(<GameGlossary />);

    const opener = screen.getByRole("button", { name: "対局中の用語を見る" });
    expect(opener).toHaveAttribute("aria-haspopup", "dialog");
    expect(opener).toHaveAttribute("aria-expanded", "false");
    expect(opener).toHaveClass("min-h-11");

    opener.focus();
    await user.keyboard("{Enter}");

    const dialog = screen.getByRole("dialog", { name: "対局中の用語" });
    expect(dialog).toHaveFocus();
    expect(opener).toHaveAttribute("aria-expanded", "true");

    for (const section of GAME_GLOSSARY) {
      expect(
        within(dialog).getByRole("heading", { name: section.heading }),
      ).toBeInTheDocument();
      for (const entry of section.entries) {
        expect(
          within(dialog).getByText(entry.term, { selector: "dt" }),
        ).toBeInTheDocument();
        expect(within(dialog).getByText(entry.description)).toBeInTheDocument();
      }
    }
    expect(
      within(dialog).getByRole("link", { name: "ルール説明を詳しく見る" }),
    ).toHaveAttribute("href", "/rules");
    expect(
      within(dialog).getByText(
        "人間は自分の手番で「北抜」を任意に選び、北を1枚ずつ公開して嶺上牌を補充できます。北を抜かずに保持したり、通常どおり打牌したりしても構いません。リーチ後はその手番でツモった北だけを抜けます。CPUは北を自動で抜き、抜いた北1枚ごとにドラが1枚増えます。",
      ),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "対局中の用語" }),
    ).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(opener).toHaveAttribute("aria-expanded", "false");
  });

  it("閉じるボタンでも説明を閉じられる", async () => {
    const user = userEvent.setup();
    render(<GameGlossary />);

    await user.click(
      screen.getByRole("button", { name: "対局中の用語を見る" }),
    );
    await user.click(screen.getByRole("button", { name: "閉じる" }));

    expect(
      screen.queryByRole("dialog", { name: "対局中の用語" }),
    ).not.toBeInTheDocument();
  });
});
