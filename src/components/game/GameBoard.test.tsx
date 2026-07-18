import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createGame } from "@/domain/game/engine";
import GameBoard from "./GameBoard";
import { GameProvider } from "./GameProvider";

// App Router の useRouter を jsdom 用にスタブ(遷移は本テストの対象外)。
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

/**
 * 実対局エンジン(seed 固定 = 決定的)で盤面を描画する。
 * 起家=自家 p0 が 東1 の親のため、開始直後は自家の打牌待ち。
 */
function renderBoard(seed = 1) {
  return render(
    <GameProvider initialGame={createGame({ seed })}>
      <GameBoard />
    </GameProvider>,
  );
}

function renderBoardWithKita() {
  const game = createGame({ seed: 1 });
  if (game.hand === null) throw new Error("hand must be initialized");
  game.hand.kita = { east: 2, south: 0, west: 1 };
  return render(
    <GameProvider initialGame={game}>
      <GameBoard />
    </GameProvider>,
  );
}

describe("GameBoard (spec 6.6 client island / engine-driven)", () => {
  it("実エンジン状態から卓情報・自家手牌・抜け番スロット・操作パネルを描画する", () => {
    renderBoard();
    // レスポンシブで md/base の両ツリーが jsdom には出るため getAll で検証。
    expect(screen.getAllByText("東1局").length).toBeGreaterThan(0);
    // 自家(p0)は着席し手牌が表向き。
    expect(
      screen.getAllByRole("listbox", { name: "自家の手牌" }).length,
    ).toBeGreaterThan(0);
    // 東1 の抜け番は三郎(p3)。
    expect(
      screen.getAllByRole("region", { name: "三郎(抜け番)" }).length,
    ).toBeGreaterThan(0);
    // 打牌待ちでは「ツモ」ボタンが操作パネルに現れる。
    expect(
      screen.getAllByRole("button", { name: "ツモ" }).length,
    ).toBeGreaterThan(0);
  });

  it("決定的な公開状態から全プレイヤーの抜き北を表示し、自家の連続北抜きを通知する", () => {
    renderBoardWithKita();

    const self = screen.getAllByRole("region", { name: "あなた(東家)" });
    expect(self.some((region) => region.textContent?.includes("ガリ2"))).toBe(
      true,
    );
    const west = screen.getAllByRole("region", { name: "二郎(西家)" });
    expect(west.some((region) => region.textContent?.includes("ガリ1"))).toBe(
      true,
    );
    expect(
      screen.getByText(
        "北を2枚抜きました。嶺上牌を補充しました。ガリは合計2枚です。",
      ),
    ).toBeInTheDocument();
  });

  it("自家の手牌をクリックすると打牌され対局が進行する", async () => {
    const user = userEvent.setup();
    renderBoard();

    const firstTile = screen.getAllByRole("option")[0];
    await user.click(firstTile);

    // 打牌後も盤面は破綻せず対局が続く(局ラベルが表示され続ける)。
    expect(screen.getAllByText(/局$/).length).toBeGreaterThan(0);
  });

  it("フォーカス表示の「全体盤面」で盤面モーダルを開閉できる(スペック5 5.3.2 段階② / 5.2.2)", async () => {
    const user = userEvent.setup();
    renderBoard();

    // 初期状態ではモーダルは開いていない。
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // フォーカス表示帯の「全体盤面」でクロス配置のモーダルを開く。
    await user.click(screen.getByRole("button", { name: "全体盤面" }));
    const dialog = screen.getByRole("dialog", { name: "全体盤面" });
    expect(dialog).toHaveAttribute("aria-modal", "true");

    // Escape でフォーカストラップ付きモーダルを閉じられる(5.2.2)。
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
