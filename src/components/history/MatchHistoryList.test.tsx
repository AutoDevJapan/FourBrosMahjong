// @vitest-environment jsdom

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendHistory,
  MATCH_HISTORY_KEY,
  type MatchHistoryEntry,
} from "@/components/game/matchHistory";
import { restoreWebLocks, stubWebLocks } from "@/test/webLocksStub";
import MatchHistoryList from "./MatchHistoryList";

function entry(
  seed: number,
  finishedAt: number,
  topName = "一郎",
): MatchHistoryEntry {
  // topName を1位に置き、残りは重複しないよう既定名から補完する。
  const names = [
    topName,
    ...["一郎", "二郎", "三郎", "四郎"].filter((name) => name !== topName),
  ].slice(0, 4);
  return {
    seed,
    finishedAt,
    players: names.map((name, i) => ({
      name,
      rank: i + 1,
      rawScore: [23_000, 8_000, -11_000, -20_000][i],
      uma: [10_000, 5_000, -5_000, -10_000][i],
      bonus: 0,
      soshiiTotal: [33_000, 13_000, -16_000, -30_000][i],
    })),
  };
}

const formatted = (finishedAt: number) =>
  new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(finishedAt));

const originalLocksDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "locks",
);

// 全件削除は Web Locks の排他区間で実行される(#482)。jsdom には `navigator.locks` が
// 無いため、追記側テストと共有の stub を差し込む。
beforeEach(() => {
  stubWebLocks();
});

afterEach(() => {
  window.localStorage.clear();
  // スパイの復元をテスト本体末尾に置くと、手前の expect が落ちた際に次のテストへ漏れる。
  vi.restoreAllMocks();
  restoreWebLocks(originalLocksDescriptor);
});

describe("MatchHistoryList (#293)", () => {
  it("保存が無ければローカル/オンラインのCTAと違いを表示する", async () => {
    render(<MatchHistoryList />);

    expect(
      await screen.findByText(/保存された戦績はまだありません/),
    ).toBeInTheDocument();
    const startGameLink = screen.getByRole("link", { name: "対局を開始" });
    expect(startGameLink).toHaveAttribute("href", "/game");
    expect(startGameLink).toHaveAccessibleDescription(
      "ローカル対局をすぐに開始できます。",
    );

    const onlineLink = screen.getByRole("link", { name: "オンライン対戦へ" });
    expect(onlineLink).toHaveAttribute("href", "/online");
    expect(onlineLink).toHaveAccessibleDescription(
      "表示名が必要です。参加する場合は6文字のルームコードも必要です。",
    );

    // CTA自体もキーボードで到達でき、既存のローカル導線の名前を維持する。
    startGameLink.focus();
    expect(startGameLink).toHaveFocus();
    onlineLink.focus();
    expect(onlineLink).toHaveFocus();
  });

  it("保存済み戦績を新しい順に一覧し、展開で内訳を閲覧できる", async () => {
    appendHistory(window.localStorage, entry(1, 1_753_000_000_000, "三郎"));
    appendHistory(window.localStorage, entry(2, 1_753_100_000_000, "四郎"));

    render(<MatchHistoryList />);

    const list = await screen.findByRole("list", {
      name: "保存された半荘結果",
    });
    // role クエリは暗黙ロールでも通るため、Safari/VoiceOver 対策の明示ロールは
    // 属性で回帰検証する(スペック5 5.2.5 / #313)。
    expect(list).toHaveAttribute("role", "list");
    const items = Array.from(list.querySelectorAll(":scope > li"));
    expect(items).toHaveLength(2);
    // 新しい半荘(seed=2)が先頭に来る。
    expect(items[0]).toHaveTextContent(formatted(1_753_100_000_000));
    expect(items[0]).toHaveTextContent("1位 四郎");
    expect(items[1]).toHaveTextContent("1位 三郎");
    expect(
      screen.queryByRole("link", { name: "対局を開始" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "オンライン対戦へ" }),
    ).not.toBeInTheDocument();

    // 展開すると結果画面と同じ最終順位・ソシー内訳を閲覧できる。
    const details = items[0].querySelector("details");
    if (!details) throw new Error("details が無い");
    expect(details.open).toBe(false);
    fireEvent.click(items[0].querySelector("summary") as HTMLElement);
    expect(details.open).toBe(true);
    const opened = within(items[0] as HTMLElement);
    expect(opened.getByRole("table")).toBeInTheDocument();
    expect(
      opened.getByRole("region", { name: /四郎のソシー内訳$/ }),
    ).toBeInTheDocument();
  });

  it("2段階確認つきで全件削除でき、キャンセルもできる", async () => {
    appendHistory(window.localStorage, entry(1, 1_753_000_000_000));

    render(<MatchHistoryList />);
    const clearButton = await screen.findByRole("button", {
      name: "戦績をすべて削除",
    });

    // キャンセル: 保存は残る。
    fireEvent.click(clearButton);
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(window.localStorage.getItem(MATCH_HISTORY_KEY)).not.toBeNull();
    expect(
      screen.getByRole("list", { name: "保存された半荘結果" }),
    ).toBeInTheDocument();

    // 実行: 保存が消え、空状態と読み上げ通知に切り替わる。
    fireEvent.click(screen.getByRole("button", { name: "戦績をすべて削除" }));
    expect(
      screen.getByText(/保存されているすべての戦績.*を削除します/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));
    // lock が空いていれば削除はミリ秒で終わる。進行中を即座に読み上げると
    // `role="status"` が1フレームに2回更新される(スペック5 5.2.3 / #488)。
    expect(screen.getByRole("status").textContent).toBe("");

    await waitFor(() =>
      expect(window.localStorage.getItem(MATCH_HISTORY_KEY)).toBeNull(),
    );
    expect(
      await screen.findByText(/保存された戦績はまだありません/),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByText("保存されていた戦績をすべて削除しました。"),
      ).toBeInTheDocument(),
    );
  });

  it("破損データは空状態で描画し、次回以降のために削除する(#302)", async () => {
    window.localStorage.setItem(
      MATCH_HISTORY_KEY,
      '{"version":1,"entries":[{}]}',
    );

    render(<MatchHistoryList />);

    expect(
      await screen.findByText(/保存された戦績はまだありません/),
    ).toBeInTheDocument();
    // 削除は描画中(getSnapshot)ではなく購読(効果)側で行われる。
    expect(window.localStorage.getItem(MATCH_HISTORY_KEY)).toBeNull();
  });

  it("別タブでの保存変更を storage イベントで取り込む(#302)", async () => {
    render(<MatchHistoryList />);
    expect(
      await screen.findByText(/保存された戦績はまだありません/),
    ).toBeInTheDocument();

    // 別タブが書き込んだ状況を再現する(jsdom は storage イベントを自動発火しない)。
    appendHistory(window.localStorage, entry(9, 1_753_200_000_000, "二郎"));
    fireEvent(window, new StorageEvent("storage", { key: MATCH_HISTORY_KEY }));

    const list = screen.getByRole("list", { name: "保存された半荘結果" });
    expect(list.querySelectorAll(":scope > li")).toHaveLength(1);
    expect(list).toHaveTextContent("1位 二郎");
  });

  it("削除できなかった場合は成功と読み上げない(#302)", async () => {
    appendHistory(window.localStorage, entry(1, 1_753_000_000_000));
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    render(<MatchHistoryList />);
    fireEvent.click(
      await screen.findByRole("button", { name: "戦績をすべて削除" }),
    );
    const confirmButton = screen.getByRole("button", { name: "削除する" });
    // 実ブラウザではクリック時にボタンへフォーカスが載る(jsdom は載せない)。
    confirmButton.focus();
    fireEvent.click(confirmButton);

    // 一覧は残っているので「削除しました」と食い違う通知を出してはいけない。
    expect(
      screen.getByRole("list", { name: "保存された半荘結果" }),
    ).toBeInTheDocument();
    // 原因はストレージ操作の失敗。接続方式(#489)ではなくストレージ設定を案内する。
    expect(
      await screen.findByText(/この端末のストレージを操作できず/),
    ).toBeInTheDocument();
    // 確認UIは畳まない。畳むと押したボタンが消え、フォーカスが body へ落ちる。
    expect(confirmButton).toBeInTheDocument();
    expect(confirmButton).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });

  it("Web Locksが無い環境(平文http)でも削除できる(#489 / ADR-0004)", async () => {
    appendHistory(window.localStorage, entry(1, 1_753_000_000_000));
    // secure context 外では `navigator.locks` が存在しない。同じオリジンでは追記も
    // 必ず失敗する = 書き戻す writer が居ないため、削除は lock 無しで実行する。
    Reflect.deleteProperty(navigator, "locks");

    render(<MatchHistoryList />);
    fireEvent.click(
      await screen.findByRole("button", { name: "戦績をすべて削除" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));

    expect(
      await screen.findByText(/保存された戦績はまだありません/),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem(MATCH_HISTORY_KEY)).toBeNull();
    expect(
      screen.getByText("保存されていた戦績をすべて削除しました。"),
    ).toBeInTheDocument();
    // 削除失敗の案内(#489 で誤案内だった文面を含む)は一切出さない。
    expect(screen.queryByText(/削除できませんでした/)).toBeNull();
  });

  it("別タブがlockを保持している場合は原因を他タブとして案内する(#488/#489)", async () => {
    appendHistory(window.localStorage, entry(1, 1_753_000_000_000));
    // 上限時間まで待っても取得できなかった場合と同じ経路(request が中断で失敗する)。
    stubWebLocks(() =>
      Promise.reject(new DOMException("timed out", "TimeoutError")),
    );

    render(<MatchHistoryList />);
    fireEvent.click(
      await screen.findByRole("button", { name: "戦績をすべて削除" }),
    );
    const confirmButton = screen.getByRole("button", { name: "削除する" });
    // 実ブラウザではクリック時にボタンへフォーカスが載る(jsdom は載せない)。
    confirmButton.focus();
    fireEvent.click(confirmButton);

    expect(
      await screen.findByText(/他のタブが戦績を更新中/),
    ).toBeInTheDocument();
    // 排他できていないので保存も一覧もそのまま残る(#482 の fail-closed)。
    expect(window.localStorage.getItem(MATCH_HISTORY_KEY)).not.toBeNull();
    expect(
      screen.getByRole("list", { name: "保存された半荘結果" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("保存されていた戦績をすべて削除しました。"),
    ).not.toBeInTheDocument();
    // 成功時と同じフォーカス契約 ─ 確認UIは畳まず、body へ落とさない。
    expect(confirmButton).toHaveFocus();
  });

  it("削除の待機中は進行中を伝え、連打しても要求を積み上げない(#488)", async () => {
    appendHistory(window.localStorage, entry(1, 1_753_000_000_000));
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    // 別タブが lock を保持していて、取得までに時間が掛かる状況。
    stubWebLocks(async (_name, _options, callback) => {
      requests++;
      await held;
      return callback();
    });

    render(<MatchHistoryList />);
    fireEvent.click(
      await screen.findByRole("button", { name: "戦績をすべて削除" }),
    );
    const confirmButton = screen.getByRole("button", { name: "削除する" });
    // 実ブラウザではクリック時にボタンへフォーカスが載る(jsdom は載せない)。
    confirmButton.focus();
    fireEvent.click(confirmButton);

    // 視覚(ラベル)は即座に、読み上げ(role="status")は待たされたときだけ伝える。
    // 「まだ読み上げていない」判定は猶予(150ms)との実時間レースになるため、
    // 非同期クエリを挟まずクリック直後に同期で確かめる。
    expect(screen.getByRole("status").textContent).toBe("");
    const busy = screen.getByRole("button", { name: "削除しています…" });
    expect(
      await screen.findByText("戦績を削除しています…"),
    ).toBeInTheDocument();
    // 操作不能は aria-disabled で表す。`disabled` にすると押した瞬間にフォーカスが
    // body へ落ちるため(削除後の着地点まで文脈が途切れる)。
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(busy).toHaveFocus();

    fireEvent.click(busy);
    fireEvent.click(busy);
    expect(requests).toBe(1);

    // 待機中のキャンセルも効かない ─ 確認UIを畳むとフォーカスの行き先が無くなる。
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(
      screen.getByRole("button", { name: "削除しています…" }),
    ).toBeInTheDocument();

    release();
    expect(
      await screen.findByText(/保存された戦績はまだありません/),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveFocus();
  });

  it("通知は読み上げ専用にせず、目でも読める形で表示する(#488)", async () => {
    appendHistory(window.localStorage, entry(1, 1_753_000_000_000));
    stubWebLocks(() =>
      Promise.reject(new DOMException("timed out", "TimeoutError")),
    );

    render(<MatchHistoryList />);
    // メッセージが無い間は読み上げ用に常設するだけ(視覚的には出さない)。
    expect(await screen.findByRole("status")).toHaveClass("sr-only");

    fireEvent.click(screen.getByRole("button", { name: "戦績をすべて削除" }));
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));

    await screen.findByText(/他のタブが戦績を更新中/);
    // 削除失敗は一覧の見た目を変えないため、sr-only のままだと晴眼の利用者へ
    // まったく伝わらない。
    expect(screen.getByRole("status")).not.toHaveClass("sr-only");
  });

  it("全件削除後はフォーカスを空状態へ移し、bodyへ落とさない", async () => {
    appendHistory(window.localStorage, entry(1, 1_753_000_000_000));

    render(<MatchHistoryList />);
    fireEvent.click(
      await screen.findByRole("button", { name: "戦績をすべて削除" }),
    );
    // 押した「削除する」ボタンごとセクションが消えるため、フォーカスの行き先が要る。
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));

    const emptyState = (
      await screen.findByText(/保存された戦績はまだありません/)
    ).closest("div");
    expect(emptyState).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });

  it("削除完了までに別タブの保存が届いてもフォーカスをbodyへ落とさない(#482)", async () => {
    appendHistory(window.localStorage, entry(1, 1_753_000_000_000));
    // 削除の lock を解放した直後に別タブの終局保存が入り、一覧が再び描かれる状況。
    // 空状態が存在しないため、着地点が無いとフォーカスは <body> へ落ちる。
    stubWebLocks(async (_name, _options, callback) => {
      const result = await callback();
      appendHistory(window.localStorage, entry(2, 1_753_100_000_000, "二郎"));
      return result;
    });

    render(<MatchHistoryList />);
    fireEvent.click(
      await screen.findByRole("button", { name: "戦績をすべて削除" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));

    const fallback = await screen.findByRole("button", {
      name: "戦績をすべて削除",
    });
    await waitFor(() => expect(fallback).toHaveFocus());
    expect(document.body).not.toHaveFocus();
  });

  it("着地点へ到達できない場合は黙らず開発ビルドで警告する(#482)", async () => {
    appendHistory(window.localStorage, entry(1, 1_753_000_000_000));
    // DOM に繋がっていても hidden / inert 配下では focus() が no-op になる(#377)。
    // jsdom では再現できないため、focus() 自体を無効化して同じ状況を作る。
    vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(<MatchHistoryList />);
    fireEvent.click(
      await screen.findByRole("button", { name: "戦績をすべて削除" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));

    await screen.findByText(/保存された戦績はまだありません/);
    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("フォーカス着地点へ到達できませんでした"),
      ),
    );
  });
});
