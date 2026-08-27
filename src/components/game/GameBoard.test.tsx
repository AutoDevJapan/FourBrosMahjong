import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGame,
  declarePon,
  discard,
  type EngineState,
  finishRound,
  HUMAN_ID,
  passRon,
  proceedToNextRound,
  type RoundConclusion,
  seatOfPlayer,
  tsumogiri,
} from "@/domain/game/engine";
import type { Tile } from "@/domain/tiles/tile";
import { bannerLandmarks, describeElement } from "@/test/bannerLandmarks";
import { tileLabel } from "../common/tileLabel";
import OnlineGameProvider from "../online/OnlineGameProvider";
import type { OnlineSnapshot } from "../online/types";
import { walkToGameEnd } from "./finishedGameFixture";
import GameBoard, {
  type GameBoardProps,
  pulledKitaCount,
  residualSticksNote,
} from "./GameBoard";
import { GameProvider } from "./GameProvider";
import { type GameAction, replayJournal } from "./gamePersistence";
import { selectView } from "./gameView";

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

function firstRoundEndGame(seed = 2024): EngineState {
  const { journal } = walkToGameEnd(seed);
  const firstNextRound = journal.actions.findIndex(
    (action) => action.type === "nextRound",
  );
  if (firstNextRound === -1) throw new Error("roundEnd を通過しない journal");
  return replayJournal({
    ...journal,
    actions: journal.actions.slice(0, firstNextRound),
  });
}

function onlineSnapshot(
  state: EngineState,
  you: "p0" | "p1",
  hostId: "p0" | "p1" = "p0",
): OnlineSnapshot {
  return {
    code: "ABC234",
    version: 0,
    you,
    hostId,
    phase: state.phase,
    view: selectView(state, you),
    pending:
      state.pending && (state.pending.playerId ?? "p0") === you
        ? state.pending
        : null,
    roundSummary: state.lastRound,
    players: [
      { id: "p0", name: "ホスト", connected: true, isHost: hostId === "p0" },
      { id: "p1", name: "ゲスト", connected: true, isHost: hostId === "p1" },
    ],
    currentTurn: state.hand ? state.hand.seating[state.hand.turn] : null,
    hostNotice:
      hostId === "p1"
        ? {
            reason: "disconnected",
            message:
              "「ホスト」さん（ホスト）が切断したため、ゲストさんへホスト権限を引き継ぎました。",
            nextAction:
              state.phase === "roundEnd"
                ? "「次の局へ」を押して対局を続けてください。"
                : state.phase === "gameEnd"
                  ? "「新しい半荘を開始」を押して次の半荘へ進めてください。"
                  : "現在の手番に従って操作してください。",
          }
        : null,
  };
}

function renderOnlineBoard(
  state: EngineState,
  you: "p0" | "p1",
  hostId: "p0" | "p1" = "p0",
) {
  const socket = { readyState: 1, send: vi.fn() } as unknown as WebSocket;
  return render(
    <OnlineGameProvider
      socket={socket}
      snapshot={onlineSnapshot(state, you, hostId)}
    >
      <GameBoard />
    </OnlineGameProvider>,
  );
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
function renderBoard(
  seed = 1,
  options?: Parameters<typeof render>[1],
  boardProps: GameBoardProps = {},
) {
  return render(
    <GameProvider initialGame={createGame({ seed })}>
      <GameBoard {...boardProps} />
    </GameProvider>,
    options,
  );
}

/** 他家の加槓に対する槍槓応答(#208)の pending を注入して描画する。 */
function renderBoardWithChankanPending() {
  const game = createGame({ seed: 1 });
  if (game.hand === null) throw new Error("hand must be initialized");
  return render(
    <GameProvider
      initialGame={{
        ...game,
        pending: {
          kind: "humanReact",
          tile: { suit: "pin", rank: 3, isRed: false },
          from: "south",
          canRon: true,
          canPon: false,
          canKan: false,
          chankan: "kakan",
        },
      }}
    >
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
    // 東1 の抜け番は糸瓜(p3)。
    expect(
      screen.getAllByRole("region", { name: "糸瓜(抜け番)" }).length,
    ).toBeGreaterThan(0);
    // 打牌待ちでは「ツモ」ボタンが操作パネルに現れる。
    expect(
      screen.getAllByRole("button", { name: "ツモ" }).length,
    ).toBeGreaterThan(0);
  });

  it("オンライン接続待ちでは手牌とサーバー操作を無効化し、接続後に戻す", () => {
    const { rerender } = renderBoard(1, undefined, {
      interactionDisabled: true,
    });

    expect(
      screen.queryByRole("listbox", { name: "自家の手牌" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByRole("list", { name: "自家の手牌" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        "オンラインサーバーとの接続を待っています。再接続後に操作を再開できます。",
      ).length,
    ).toBeGreaterThan(0);

    for (const panel of screen.getAllByRole("group", {
      name: "操作パネル",
    })) {
      for (const button of within(panel).getAllByRole("button")) {
        expect(button).toBeDisabled();
      }
    }

    rerender(
      <GameProvider initialGame={createGame({ seed: 1 })}>
        <GameBoard interactionDisabled={false} />
      </GameProvider>,
    );
    expect(
      screen.getAllByRole("listbox", { name: "自家の手牌" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByText(
        "オンラインサーバーとの接続を待っています。再接続後に操作を再開できます。",
      ),
    ).not.toBeInTheDocument();
  });

  it("自動再接続を終えた接続失敗では再試行導線を案内する", () => {
    renderBoard(1, undefined, {
      interactionDisabled: true,
      interactionDisabledReason: "failed",
    });

    expect(
      screen.getAllByText(
        "オンラインサーバーへの接続に失敗しました。再試行ボタンで接続を再開できます。",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByText(
        "オンラインサーバーとの接続を待っています。再接続後に操作を再開できます。",
      ),
    ).not.toBeInTheDocument();
  });

  it("決定的な公開状態から全プレイヤーの抜き北を表示し、自家の連続北抜きを通知する", () => {
    renderBoardWithKita();

    const self = screen.getAllByRole("region", { name: "粗悪品(東家)" });
    expect(self.some((region) => region.textContent?.includes("ガリ2"))).toBe(
      true,
    );
    const west = screen.getAllByRole("region", { name: "マサキ(西家)" });
    expect(west.some((region) => region.textContent?.includes("ガリ1"))).toBe(
      true,
    );
    expect(
      screen.getByText(
        "北を2枚抜きました。嶺上牌を補充しました。ガリは合計2枚です。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("あなたの手番です。北抜できます。"),
    ).toBeInTheDocument();
  });

  it("北を持つ自手番では北抜を明示選択でき、補充・ガリ表示・同一手番を更新する", async () => {
    const user = userEvent.setup();
    renderBoard(1);

    expect(
      screen.getAllByRole("button", { name: "北抜" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "チー" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByText("北抜を選ぶか、牌を選んで打牌してください。").length,
    ).toBeGreaterThan(0);

    await user.click(screen.getAllByRole("button", { name: "北抜" })[0]);

    const selfAfterOne = screen.getAllByRole("region", {
      name: "あなた(東家)",
    });
    expect(
      selfAfterOne.some((region) => region.textContent?.includes("ガリ1")),
    ).toBe(true);
    expect(
      screen.getByText(
        "北を抜きました。嶺上牌を補充しました。ガリは合計1枚です。",
      ),
    ).toBeInTheDocument();
    // seed=1 は配牌と第1ツモの2枚が北。1枚抜いた後も同じ手番で再度選べる。
    expect(
      screen.getAllByRole("button", { name: "北抜" }).length,
    ).toBeGreaterThan(0);

    await user.click(screen.getAllByRole("button", { name: "北抜" })[0]);
    expect(
      screen.queryByRole("button", { name: "北抜" }),
    ).not.toBeInTheDocument();
    const selfAfterTwo = screen.getAllByRole("region", {
      name: "あなた(東家)",
    });
    expect(
      selfAfterTwo.some((region) => region.textContent?.includes("ガリ2")),
    ).toBe(true);
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

  it("槍槓応答(#208)ではロン/スルーのみ提示し、槍槓である旨を案内する", () => {
    renderBoardWithChankanPending();

    expect(
      screen.getAllByRole("button", { name: "ロン" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: "スルー" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "ポン" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByText(
        "他家のカン宣言に槍槓ロンできます。ロン / スルーを選べます。",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("自家の手牌をクリックすると打牌され対局が進行する", async () => {
    const user = userEvent.setup();
    renderBoard();

    const firstTile = screen.getAllByRole("option")[0];
    await user.click(firstTile);

    // 打牌後も盤面は破綻せず対局が続く(局ラベルが表示され続ける)。
    expect(screen.getAllByText(/局$/).length).toBeGreaterThan(0);
  });

  it("狭幅表示は設定ではなく自動適用の状態説明として伝え、全体盤面をキーボードで開ける(#613)", async () => {
    const user = userEvent.setup();
    renderBoard();

    const description = screen.getByTestId("narrow-board-description");
    expect(description).not.toHaveAttribute("role");
    expect(description).not.toHaveAttribute("aria-live");
    expect(description).toHaveTextContent(
      "狭い画面のため、自分の手牌を自動で優先表示しています。",
    );
    expect(description).not.toHaveAttribute("tabindex");
    expect(
      screen.queryByRole("button", { name: "自分手番フォーカス表示" }),
    ).not.toBeInTheDocument();

    const opener = screen.getByRole("button", { name: "全体盤面" });
    expect(opener).toHaveAttribute("aria-describedby", description.id);
    opener.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "全体盤面" })).toBeVisible();
  });

  it("フォーカス表示の「全体盤面」で盤面モーダルを開閉できる(スペック5 5.3.2 段階② / 5.2.2)", async () => {
    const user = userEvent.setup();
    // `/game` と同じく `<main>` の内側へ置いて描く。`GameBoard` を裸で描くと、盤面ルート
    // (`role="group"`)は banner 抑止の祖先ではないため、下の banner 判定が実ページと
    // 違う条件で走ってしまう(盤面直下に `<header>` を足したときだけ偽陽性になる)。
    // 描画は共通ヘルパを使う — ここで provider を書き写すと、ヘルパ側の変更が
    // **この 1 本にだけ**届かなくなる(モーダル経路の banner 検査はここにしかない)。
    renderBoard(1, {
      wrapper: ({ children }) => <main>{children}</main>,
    });

    // 初期状態ではモーダルは開いていない。
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // フォーカス表示帯の「全体盤面」でクロス配置のモーダルを開く。
    await user.click(screen.getByRole("button", { name: "全体盤面" }));
    const dialog = screen.getByRole("dialog", { name: "全体盤面" });
    expect(dialog).toHaveAttribute("aria-modal", "true");

    // spec 5.2.6 / #431: どのルートも banner ランドマークを公開しない。`Modal` は
    // `document.body` 直下へポータルするため**ページの `<main>` の外**に出る。
    // `[role="dialog"]` は `<header>` の暗黙 banner を抑止しないので、モーダル内に
    // `<header>` を足すと banner が生える — ルート単位のゲート
    // (`src/test/a11y-heading-placement.test.tsx`)はモーダルを開かないので見えない。
    expect(
      bannerLandmarks(document.body).map(describeElement),
      "モーダル表示中に banner ランドマークが生えている(spec 5.2.6 / #431)",
    ).toEqual([]);

    // Escape でフォーカストラップ付きモーダルを閉じられる(5.2.2)。
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("トリガー到達不能時の復帰先(盤面ルート)はロールとアクセシブル名を持つ(スペック5 5.2.2 / #405)", async () => {
    const user = userEvent.setup();
    renderBoard();

    const opener = screen.getByRole("button", { name: "全体盤面" });
    await user.click(opener);
    expect(
      screen.getByRole("dialog", { name: "全体盤面" }),
    ).toBeInTheDocument();

    // 卓幅が 360px 以上へ変わり、トリガーがコンテナクエリの display:none で隠れた状態
    // (#377)を模す。jsdom はコンテナクエリを評価せず、インラインの display:none でも
    // focus() を no-op にしないため、到達不能の代替として disabled を使う判断は
    // Modal.test.tsx の UnreachableTriggerHarness と同じ。ただし機構は違い、あちらは prop、
    // ここは GameBoard が JSX で与えていない属性を直接立てる(与えていない以上、
    // 以降の再描画で React に上書きされない)。
    opener.setAttribute("disabled", "");
    await user.keyboard("{Escape}");

    // 着地点はモーダルが補完していた領域のルート = 盤面ルート。素の <div> のままだと
    // フォーカスリングは出てもスクリーンリーダへ移動先が伝わらないため、名前を要求する。
    const boardRoot = screen.getByRole("group", { name: "対局盤面" });
    expect(boardRoot).toHaveFocus();
    expect(boardRoot).toHaveAttribute("tabindex", "-1");
  });
});

describe("GameBoard 打牌フェーズ外の自家手牌(#257)", () => {
  /** 最初の局終了(roundEnd)直後の状態(seed 固定で決定的)。 */
  function roundEndGame(seed = 2024): EngineState {
    const { journal } = walkToGameEnd(seed);
    const firstNextRound = journal.actions.findIndex(
      (action) => action.type === "nextRound",
    );
    if (firstNextRound === -1) {
      throw new Error("roundEnd を通過しない journal");
    }
    return replayJournal({
      ...journal,
      actions: journal.actions.slice(0, firstNextRound),
    });
  }

  /** 自家手牌が閲覧専用(静的 list)で、禁止バッジ・理由文が無いことを検証する。 */
  function expectReadOnlyHand() {
    // 対話ロール(listbox/option)は公開されない(#187 の全体盤面モーダルと同一挙動)。
    expect(
      screen.queryAllByRole("listbox", { name: "自家の手牌" }),
    ).toHaveLength(0);
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    // 静的 list としては公開され続ける(牌の閲覧は可能)。
    expect(
      screen.getAllByRole("list", { name: "自家の手牌" }).length,
    ).toBeGreaterThan(0);
    // 「禁止」バッジと disabled 理由文の読み上げノイズが無い(スペック5 5.2.3)。
    expect(screen.queryAllByText("禁止")).toHaveLength(0);
    expect(screen.queryAllByLabelText(/現在は打牌できません/)).toHaveLength(0);
  }

  it("局終了(roundEnd)では自家手牌が閲覧専用になり、禁止バッジ・理由文が付かない", () => {
    render(
      <GameProvider initialGame={roundEndGame()}>
        <GameBoard />
      </GameProvider>,
    );
    expectReadOnlyHand();
  });

  it("半荘終了(gameEnd)でも自家手牌は閲覧専用で、禁止バッジ・理由文が付かない", () => {
    render(
      <GameProvider initialGame={finishedGame()}>
        <GameBoard />
      </GameProvider>,
    );
    expectReadOnlyHand();
  });

  it("他家打牌への応答待ち(humanReact)でも自家手牌は閲覧専用(操作は ActionPanel が担う)", () => {
    renderBoardWithChankanPending();
    expectReadOnlyHand();
    // 応答操作自体は ActionPanel 側で提供され続ける。
    expect(
      screen.getAllByRole("button", { name: "ロン" }).length,
    ).toBeGreaterThan(0);
  });
});

describe("GameBoard 終局後の出口(#206 / #207 / #277)", () => {
  it("対局中に gameEnd へ遷移しても自動遷移せず、最終局の和了内訳・点数増減を表示してからボタンで結果画面へ進める(#277)", async () => {
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

    // 半荘を終える局は自動遷移しない(#277: 内訳表示をスキップさせない)。
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(routerMock.push).not.toHaveBeenCalled();

    // 最終局(seed=2024 は東4・竜二のロン 7,700点 / #294 の AI 変更後に再確認)の和了内訳が表示される。
    expect(
      screen.getAllByRole("heading", { name: "和了内訳" }).length,
    ).toBeGreaterThan(0);
    // 各家の点数増減(±デルタ)も表示される(自家 −7,700 / 竜二 +8,700 = 7,700 + 供託1,000)。
    expect(screen.getAllByText("−7,700").length).toBeGreaterThan(0);
    expect(screen.getAllByText("+8,700").length).toBeGreaterThan(0);

    // 出口はユーザー操作:「結果を見る」で結果画面へ(push。自動 replace はしない)。
    await user.click(screen.getAllByRole("button", { name: "結果を見る" })[0]);
    expect(routerMock.push).toHaveBeenCalledWith("/game/result");
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("終局済み状態でマウントされた場合(リロード復元・ブラウザバック相当)も同じ決着表示と出口を提示する", async () => {
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

    // リロード復元でも最終局の決着(和了内訳・点数増減)が同じく表示される(#277 / #193)。
    expect(
      screen.getAllByRole("heading", { name: "和了内訳" }).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("−7,700").length).toBeGreaterThan(0);

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

describe("GameBoard online host handoff controls(#681 / #678)", () => {
  it("guestはroundEndでhost-only操作を隠し、ホスト待ちを表示する", () => {
    renderOnlineBoard(firstRoundEndGame(), "p1");

    expect(screen.queryAllByRole("button", { name: "次の局へ" })).toHaveLength(
      0,
    );
    expect(
      screen.getAllByText(/ホストの操作を待っています。/).length,
    ).toBeGreaterThan(0);
  });

  it("引継ぎ後のguestは動的hostIdに従ってroundEndを進められる", () => {
    renderOnlineBoard(firstRoundEndGame(), "p1", "p1");

    expect(
      screen.getAllByRole("button", { name: "次の局へ" }).length,
    ).toBeGreaterThan(0);
  });

  it("roundEnd のhostには次の局へを有効表示する", () => {
    renderOnlineBoard(firstRoundEndGame(), "p0");

    expect(
      screen
        .getAllByRole("button", { name: "次の局へ" })
        .some((button) => !button.hasAttribute("disabled")),
    ).toBe(true);
  });

  it("guestはgameEndで新半荘ボタンを隠し、host-only待ちを案内する", () => {
    renderOnlineBoard(finishedGame(), "p1");

    expect(
      screen.getAllByRole("button", { name: "結果を見る" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryAllByRole("button", { name: "新しい半荘を開始" }),
    ).toHaveLength(0);
    expect(
      screen.getAllByText(/ホストの操作を待っています。/).length,
    ).toBeGreaterThan(0);
  });

  it("引継ぎ後のhostにはgameEndの新半荘操作を表示する", () => {
    renderOnlineBoard(finishedGame(), "p1", "p1");

    expect(
      screen.getAllByRole("button", { name: "新しい半荘を開始" }).length,
    ).toBeGreaterThan(0);
  });

  it("gameEnd のguestには結果を見るだけを表示し、新しい半荘を操作させない", () => {
    renderOnlineBoard(finishedGame(), "p1");

    expect(
      screen.getAllByRole("button", { name: "結果を見る" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryAllByRole("button", { name: "新しい半荘を開始" }),
    ).toHaveLength(0);
    expect(
      screen.getAllByText(/ホストの操作を待っています。/).length,
    ).toBeGreaterThan(0);
  });

  it("gameEnd のhostには結果を見ると新しい半荘を表示する", () => {
    renderOnlineBoard(finishedGame(), "p0");

    expect(
      screen.getAllByRole("button", { name: "結果を見る" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen
        .getAllByRole("button", { name: "新しい半荘を開始" })
        .some((button) => !button.hasAttribute("disabled")),
    ).toBe(true);
  });
});

describe("GameBoard 残存供託の帰属表示(#282)", () => {
  /** 南4親流れ流局+供託2本残存で終局した状態(単独最高 p0 = 粗悪品 が取得)。 */
  function drawEndedGameWithResidual(): EngineState {
    const base = createGame({ seed: 130 });
    const conclusion: RoundConclusion = {
      outcome: "dealerPasses",
      isDraw: true,
      summary: {
        kind: "draw",
        label: "流局(テンパイ0人)",
        deltas: { p0: 0, p1: 0, p2: 0, p3: 0 },
      },
    };
    return finishRound(
      {
        ...base,
        round: { ...base.round, wind: "south", roundNumber: 4 },
        points: { p0: 52000, p1: 30000, p2: 31000, p3: 25000 },
        riichiSticks: 2,
      },
      conclusion,
    );
  }

  it("流局終了+供託残存の hint に残存供託の帰属を併記し、受取者のデルタ表示と整合する", () => {
    const state = drawEndedGameWithResidual();
    expect(state.phase).toBe("gameEnd");
    render(
      <GameProvider initialGame={state}>
        <GameBoard />
      </GameProvider>,
    );

    // hint(唯一の可視サマリ)に残存供託の帰属が明記される。
    expect(
      screen.getAllByText(/残存供託2本（2,000点）は粗悪品が取得。/).length,
    ).toBeGreaterThan(0);
    // 受取者のデルタ表示(+2,000)が持ち点(54,000)・供託カウント0と整合する。
    expect(screen.getAllByText("+2,000").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        (_, element) =>
          element?.tagName === "SPAN" && element.textContent === "54,000点",
      ).length,
    ).toBeGreaterThan(0);
    // 卓情報の供託カウントは 0(場から下りた供託がデルタ+持ち点に反映済み)。
    const kyotakuValues = screen
      .getAllByText("供託")
      .map((dt) => dt.nextElementSibling?.textContent);
    expect(kyotakuValues.length).toBeGreaterThan(0);
    for (const value of kyotakuValues) expect(value).toBe("0");
  });

  it("residualSticksNote は残存供託が無ければ空文字を返す", () => {
    expect(residualSticksNote(null)).toBe("");
    expect(residualSticksNote({ residualSticks: undefined })).toBe("");
    expect(
      residualSticksNote({
        residualSticks: {
          recipientId: "p1",
          recipientName: "一郎",
          sticks: 1,
          points: 1000,
        },
      }),
    ).toBe("残存供託1本（1,000点）は一郎が取得。");
  });
});

describe("GameBoard 対話 a11y 経路(#285)", () => {
  /** 牌種一致(赤ドラ差は無視)。engine の喰い替え禁止・打牌候補判定と同じ比較粒度。 */
  function sameKind(a: Tile, b: Tile): boolean {
    return a.suit === b.suit && a.rank === b.rank;
  }

  /** 自家(p0)の現在の純手牌(ツモ牌を除く)。 */
  function selfHandTiles(state: EngineState): readonly Tile[] {
    if (!state.hand) return [];
    const seat = seatOfPlayer(state.hand.seating, HUMAN_ID);
    return seat === null ? [] : state.hand.hands[seat];
  }

  /**
   * 決定的方針で1手進める(打牌はツモ切り優先・応答は `usePon` ならポン、それ以外スルー・
   * 局終了は次局へ)。`walkToGameEnd` と同系の完走方針だが、ポン方針(喰い替え禁止・加槓の
   * 局面到達に必須)と、ポン直後(ツモ牌なし)の手出し打牌を追加でサポートする。
   */
  function advanceOnce(
    state: EngineState,
    usePon: boolean,
  ): EngineState | null {
    if (state.phase === "gameEnd") return null;
    if (state.phase === "roundEnd") return proceedToNextRound(state);
    if (state.pending?.kind === "humanDiscard") {
      const pending = state.pending;
      if (pending.locked) return tsumogiri(state);
      const drawn = state.hand?.drawn?.tile;
      if (drawn && !pending.forbiddenDiscards.some((f) => sameKind(f, drawn))) {
        return discard(state, drawn);
      }
      // ポン直後はツモ牌が無いため、喰い替え禁止でない先頭の手牌を切る。
      const candidate = selfHandTiles(state).find(
        (tile) => !pending.forbiddenDiscards.some((f) => sameKind(f, tile)),
      );
      return candidate === undefined ? null : discard(state, candidate);
    }
    if (state.pending?.kind === "humanReact") {
      if (usePon && state.pending.canPon) return declarePon(state);
      return passRon(state);
    }
    return null;
  }

  /**
   * seed 固定の実エンジンを決定的方針で進め、`predicate` が成立した局面を返す(到達は
   * seed 探索で事前確認済み。将来 engine の進行が変わって未到達になれば throw で検知する)。
   */
  function walkTo(
    seed: number,
    predicate: (state: EngineState) => boolean,
    usePon = false,
  ): EngineState {
    let state = createGame({ seed });
    for (let guard = 0; guard < 3000; guard++) {
      if (predicate(state)) return state;
      const next = advanceOnce(state, usePon);
      if (next === null) break;
      state = next;
    }
    throw new Error(`seed=${seed} で目的局面に到達しなかった`);
  }

  /** リーチ宣言可能な自家打牌待ち(seed=53: 宣言牌は八索のみ・東1)。 */
  function riichiReadyGame(): EngineState {
    return walkTo(
      53,
      (s) => s.pending?.kind === "humanDiscard" && s.pending.canRiichi,
    );
  }

  function renderGame(state: EngineState) {
    return render(
      <GameProvider initialGame={state}>
        <GameBoard />
      </GameProvider>,
    );
  }

  it("リーチボタンで宣言モードに入り、適格牌に「リーチ可」・非適格牌に「禁止」+理由が付き、再押下で解除できる", async () => {
    const user = userEvent.setup();
    renderGame(riichiReadyGame());

    // 宣言モード前はインジケータなし。
    expect(screen.queryAllByText("リーチ可")).toHaveLength(0);
    expect(screen.queryAllByText("禁止")).toHaveLength(0);

    await user.click(screen.getAllByRole("button", { name: "リーチ" })[0]);

    // 宣言モード: ボタンは解除ラベルへ、hint は宣言牌の選択を案内。
    expect(
      screen.getAllByRole("button", { name: "リーチ解除" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        "リーチ宣言牌を選んでください(テンパイを保つ牌のみ有効)。",
      ).length,
    ).toBeGreaterThan(0);
    // 適格牌(八索)は色に依存しない「リーチ可」テキスト+aria-label で示される。
    expect(
      screen.getAllByRole("option", { name: "八索、リーチ可" }).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("リーチ可").length).toBeGreaterThan(0);
    // 非適格牌(六筒)は「禁止」バッジ+理由文つきで選択不可。
    const blocked = screen.getAllByRole("option", {
      name: "六筒、この牌ではテンパイを保てないため、リーチ宣言できません。",
    });
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked[0]).toHaveAttribute("aria-disabled", "true");
    expect(screen.getAllByText("禁止").length).toBeGreaterThan(0);

    // 非適格牌のクリックは no-op で、理由がライブリージョンへ通知される。
    await user.click(blocked[0]);
    expect(
      screen.getByText(
        "この牌ではテンパイを保てないため、リーチ宣言できません。",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "リーチ解除" }).length,
    ).toBeGreaterThan(0);

    // 再押下で宣言モードを解除でき、インジケータが消える。
    await user.click(screen.getAllByRole("button", { name: "リーチ解除" })[0]);
    expect(
      screen.getAllByRole("button", { name: "リーチ" }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryAllByText("リーチ可")).toHaveLength(0);
    expect(screen.queryAllByText("禁止")).toHaveLength(0);
  });

  it("宣言モードで適格牌を選ぶとリーチが宣言され、以後の自手番はロック表示+ツモ切り導線になる", async () => {
    const user = userEvent.setup();
    renderGame(riichiReadyGame());

    await user.click(screen.getAllByRole("button", { name: "リーチ" })[0]);
    await user.click(
      screen.getAllByRole("option", { name: "八索、リーチ可" })[0],
    );

    // 自家の状態バッジに「リーチ」が付く(色非依存のテキスト表示)。
    const selfRegions = screen.getAllByRole("region", { name: /^粗悪品/ });
    expect(
      selfRegions.some((region) => region.textContent?.includes("リーチ")),
    ).toBe(true);
    // 次の自手番はロック中: hint とツモ切りボタンで導線を提示。
    expect(
      screen.getAllByText(/^リーチ中です。.*ツモ切りを選べます。$/).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: "ツモ切り" }).length,
    ).toBeGreaterThan(0);
    // 全手牌が「禁止」+理由文つきで選択不可(色非依存インジケータ)。
    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option).toHaveAttribute("aria-disabled", "true");
    }
    expect(
      screen.getAllByRole("option", {
        name: /、リーチ中は手牌から打牌できません。ツモ切りを選んでください。$/,
      }),
    ).toHaveLength(options.length);
    expect(screen.getAllByText("禁止").length).toBeGreaterThan(0);

    // ロック中の牌クリックは no-op で、理由がライブリージョンへ通知される。
    await user.click(options[0]);
    expect(
      screen.getByText(
        "リーチ中は手牌から打牌できません。ツモ切りを選んでください。",
      ),
    ).toBeInTheDocument();

    // この局面はリーチ後も北を保持している。北抜は選べ、補充後もロックと
    // ツモ切り導線を維持する。
    expect(
      screen.getAllByRole("button", { name: "北抜" }).length,
    ).toBeGreaterThan(0);
    await user.click(screen.getAllByRole("button", { name: "北抜" })[0]);
    expect(
      screen.getAllByRole("button", { name: "ツモ切り" }).length,
    ).toBeGreaterThan(0);
    await user.click(screen.getAllByRole("button", { name: "ツモ切り" })[0]);
    expect(screen.getAllByText(/局$/).length).toBeGreaterThan(0);
  });

  // `walkTo` executes the real engine until a post-pon state. Under the full
  // multi-project run it can exceed the component project's 5s default while
  // still completing promptly in isolation; keep a bounded, case-specific
  // budget instead of weakening the global hang detector.
  it("ポン直後の打牌待ちでは喰い替え禁止牌に「禁止」+理由が付き、クリックしても打牌が進行しない", async () => {
    const user = userEvent.setup();
    // seed=4 をポン方針で進めると、發ポン直後に手牌へ發が1枚残る打牌待ちに到達する。
    renderGame(
      walkTo(
        4,
        (s) =>
          s.pending?.kind === "humanDiscard" &&
          s.pending.forbiddenDiscards.length > 0 &&
          selfHandTiles(s).some((tile) =>
            (s.pending?.kind === "humanDiscard"
              ? s.pending.forbiddenDiscards
              : []
            ).some((f) => sameKind(f, tile)),
          ),
        true,
      ),
    );

    // 喰い替え禁止牌(發)は「禁止」バッジ+理由文つきで選択不可。
    const forbidden = screen.getAllByRole("option", {
      name: "發、喰い替え禁止のため、この牌は打牌できません。",
    });
    expect(forbidden.length).toBeGreaterThan(0);
    expect(forbidden[0]).toHaveAttribute("aria-disabled", "true");
    expect(screen.getAllByText("禁止").length).toBeGreaterThan(0);

    // クリックは no-op: 理由が通知され、打牌は進行しない(禁止牌が手牌に残る)。
    await user.click(forbidden[0]);
    expect(
      screen.getByText("喰い替え禁止のため、この牌は打牌できません。"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("option", {
        name: "發、喰い替え禁止のため、この牌は打牌できません。",
      }),
    ).toHaveLength(forbidden.length);

    // 禁止でない牌(西)は打牌でき、対局が進行して禁止バッジが消える。
    await user.click(screen.getAllByRole("option", { name: "西" })[0]);
    expect(screen.queryAllByText("禁止")).toHaveLength(0);
  }, 30_000);

  it("暗槓できる牌があるとき「暗槓 <牌>」ボタンが現れ、実行すると自家の副露に暗槓が並ぶ", async () => {
    const user = userEvent.setup();
    // seed=8 をツモ切り方針で進めると、一萬4枚の暗槓が可能な打牌待ちに到達する。
    renderGame(
      walkTo(
        8,
        (s) =>
          s.pending?.kind === "humanDiscard" && s.pending.ankanTiles.length > 0,
      ),
    );

    const selfBefore = screen.getAllByRole("region", { name: /^粗悪品/ })[0];
    expect(
      within(selfBefore).queryAllByRole("listitem", { name: "暗槓" }),
    ).toHaveLength(0);

    await user.click(screen.getAllByRole("button", { name: "暗槓 一萬" })[0]);

    // 実行後: ボタンは消え、自家の副露に暗槓が表示され、嶺上補充後の打牌待ちが続く。
    expect(screen.queryAllByRole("button", { name: "暗槓 一萬" })).toHaveLength(
      0,
    );
    const selfAfter = screen.getAllByRole("region", { name: /^粗悪品/ })[0];
    expect(
      within(selfAfter).getAllByRole("listitem", { name: "暗槓" }),
    ).toHaveLength(1);
    expect(
      screen.getAllByText("牌を選んで打牌してください。").length,
    ).toBeGreaterThan(0);
  });

  it("加槓できる牌があるとき「加槓 <牌>」ボタンが現れ、実行するとポンがカンへ置き換わる", async () => {
    const user = userEvent.setup();
    // seed=1 をポン方針で進めると、東ポン済み+4枚目ツモで加槓可能な打牌待ちに到達する。
    renderGame(
      walkTo(
        1,
        (s) =>
          s.pending?.kind === "humanDiscard" && s.pending.kakanTiles.length > 0,
        true,
      ),
    );

    const selfBefore = screen.getAllByRole("region", { name: /^粗悪品/ })[0];
    expect(
      within(selfBefore).getAllByRole("listitem", { name: "ポン" }).length,
    ).toBeGreaterThan(0);

    await user.click(screen.getAllByRole("button", { name: "加槓 東" })[0]);

    // 実行後: ボタンは消え、自家の副露はポンからカンへ置き換わる。
    expect(screen.queryAllByRole("button", { name: "加槓 東" })).toHaveLength(
      0,
    );
    const selfAfter = screen.getAllByRole("region", { name: /^粗悪品/ })[0];
    expect(
      within(selfAfter).queryAllByRole("listitem", { name: "ポン" }),
    ).toHaveLength(0);
    expect(
      within(selfAfter).getAllByRole("listitem", { name: "カン" }).length,
    ).toBeGreaterThan(0);
  });

  it("リーチ可能でなくなった遷移で宣言モードが自動解除される(前回値比較の解除経路)", async () => {
    const user = userEvent.setup();
    // 実局面(seed=8 の暗槓可能局面)は canRiichi=false のため、公開 Pending の形を保ったまま
    // リーチ可能フラグのみ注入する(状態直接構築)。暗槓の実行自体は実 engine が受理し、
    // 遷移後の再計算で canRiichi が失われる(=打牌以外の遷移で宣言モードが取り残される)状況を作る。
    const base = walkTo(
      8,
      (s) =>
        s.pending?.kind === "humanDiscard" && s.pending.ankanTiles.length > 0,
    );
    if (base.pending?.kind !== "humanDiscard") throw new Error("unreachable");
    renderGame({
      ...base,
      pending: { ...base.pending, canRiichi: true, riichiTiles: [] },
    });

    // 同時に合法なカン系操作は、デスクトップ/狭幅で共有するDOM配列上でもリーチより前に置く。
    for (const panel of screen.getAllByRole("group", { name: "操作パネル" })) {
      expect(
        within(panel)
          .getAllByRole("button")
          .map((button) => button.getAttribute("data-action-key")),
      ).toEqual(["tsumo", "ankan-man-1", "riichi"]);
    }
    // 三麻にはチーを追加しない。
    expect(screen.queryByRole("button", { name: "チー" })).toBeNull();

    await user.click(screen.getAllByRole("button", { name: "リーチ" })[0]);
    expect(
      screen.getAllByText(
        "リーチ宣言牌を選んでください(テンパイを保つ牌のみ有効)。",
      ).length,
    ).toBeGreaterThan(0);

    // 宣言モードのまま暗槓を実行(打牌を経ない実遷移)。
    await user.click(screen.getAllByRole("button", { name: "暗槓 一萬" })[0]);

    // 遷移後は canRiichi が失われ、宣言モードが自動解除される(取り残された armed 表示にならない)。
    expect(
      screen.queryAllByRole("button", { name: "リーチ解除" }),
    ).toHaveLength(0);
    expect(
      screen.queryAllByText(
        "リーチ宣言牌を選んでください(テンパイを保つ牌のみ有効)。",
      ),
    ).toHaveLength(0);
    expect(
      screen.getAllByText("牌を選んで打牌してください。").length,
    ).toBeGreaterThan(0);
  });
});
