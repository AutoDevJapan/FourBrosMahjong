import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGame, type EngineState } from "@/domain/game/engine";
import { tileLabel } from "../common/tileLabel";
import { walkToGameEnd } from "./finishedGameFixture";
import GameBoard, { pulledKitaCount } from "./GameBoard";
import { type GameAction, replayJournal } from "./gamePersistence";
import { GameProvider } from "./GameProvider";

// App Router の useRouter を jsdom 用にスタブ(push/replace の呼び分けを検証する)。
const routerMock = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
}));

beforeEach(() => {
  routerMock.push.mockClear();
  routerMock.replace.mockClear();
  // `newGame` は sessionStorage へ journal を書き込む。現状の各テストは journal を読み戻さない
  // (常に initialGame を注入する)が、後続テストへの書き残しを避けるため毎回クリアする。
  window.sessionStorage.clear();
});

/** 半荘を完走した終局(gameEnd)状態(seed 固定で決定的)。 */
function finishedGame(seed = 2024): EngineState {
  return walkToGameEnd(seed).state;
}

/** 終局の1手前の局面と、gameEnd へ遷移させる最終操作を返す。 */
function gameBeforeEnd(seed = 2024): {
  state: EngineState;
  lastAction: GameAction;
} {
  const { journal } = walkToGameEnd(seed);
  const lastAction = journal.actions[journal.actions.length - 1];
  return {
    // engine の遷移は内部状態を破壊的に更新するため、途中局面は journal の部分再生で新規構築する。
    state: replayJournal({
      ...journal,
      actions: journal.actions.slice(0, -1),
    }),
    lastAction,
  };
}

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
    expect(screen.getByText("あなたの手番です。")).toBeInTheDocument();
  });

  it("同じガリ枚数でも局キーが変われば新しい北抜きとして検知する", () => {
    expect(
      pulledKitaCount({ roundKey: "east-1-0", count: 1 }, "east-1-0", 1),
    ).toBe(0);
    expect(
      pulledKitaCount({ roundKey: "east-1-0", count: 1 }, "east-2-0", 1),
    ).toBe(1);
    expect(
      pulledKitaCount({ roundKey: "east-1-0", count: 1 }, "east-1-1", 1),
    ).toBe(1);
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

describe("GameBoard 終局後の出口(#206 / #207)", () => {
  it("対局中に gameEnd へ遷移した瞬間だけ router.replace で結果画面へ自動遷移する", async () => {
    const user = userEvent.setup();
    const { state, lastAction } = gameBeforeEnd();
    render(
      <GameProvider initialGame={state}>
        <GameBoard />
      </GameProvider>,
    );
    expect(routerMock.replace).not.toHaveBeenCalled();

    // 記録済みの最終操作を UI から実行して gameEnd へ遷移させる。gameEnd は打牌/スルーの
    // 決着処理からのみ到達する(`proceedToNextRound` は gameEnd を返さない)ため、この2択で足りる。
    if (lastAction.type === "discard") {
      await user.click(
        screen.getAllByRole("option", { name: tileLabel(lastAction.tile) })[0],
      );
    } else if (lastAction.type === "passRon") {
      await user.click(screen.getAllByRole("button", { name: "スルー" })[0]);
    } else {
      throw new Error(`最終操作を UI から実行できない: ${lastAction.type}`);
    }

    // 自動遷移は replace(履歴を汚さない)。push は使わない(#206)。
    expect(routerMock.replace).toHaveBeenCalledWith("/game/result");
    expect(routerMock.replace).toHaveBeenCalledTimes(1);
    expect(routerMock.push).not.toHaveBeenCalled();
    // 自動遷移が予約されている間は出口パネルを描かず、遷移案内のみ表示する(明滅防止)。
    expect(
      screen.queryByRole("button", { name: "新しい半荘を開始" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByText("半荘終了。結果画面へ移動します。").length,
    ).toBeGreaterThan(0);
  });

  it("終局済み状態でマウントされた場合は自動遷移せず、結果を見る/新しい半荘を開始の出口を提示する", async () => {
    const user = userEvent.setup();
    render(
      <GameProvider initialGame={finishedGame()}>
        <GameBoard />
      </GameProvider>,
    );

    // 終局 journal の復元・結果画面からのブラウザバック相当(マウント時点で gameEnd)では
    // 強制リダイレクトしない(#207: ロビー「対局を開始」で /game に留まれる)。
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(routerMock.push).not.toHaveBeenCalled();

    // 「結果を見る」はユーザー操作としての push 遷移。
    await user.click(screen.getAllByRole("button", { name: "結果を見る" })[0]);
    expect(routerMock.push).toHaveBeenCalledWith("/game/result");

    // 「新しい半荘を開始」で新規半荘が始まり、打牌待ちの操作パネルへ戻る。
    await user.click(
      screen.getAllByRole("button", { name: "新しい半荘を開始" })[0],
    );
    expect(
      screen.getAllByRole("button", { name: "ツモ" }).length,
    ).toBeGreaterThan(0);
    // 新規半荘の開始(gameEnd → playing)でも自動遷移は発火しない。
    expect(routerMock.replace).not.toHaveBeenCalled();
  });
});
