// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendHistory,
  MATCH_HISTORY_KEY,
  type MatchHistoryEntry,
} from "@/components/game/matchHistory";
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

afterEach(() => {
  window.localStorage.clear();
  // スパイの復元をテスト本体末尾に置くと、手前の expect が落ちた際に次のテストへ漏れる。
  vi.restoreAllMocks();
});

describe("MatchHistoryList (#293)", () => {
  it("保存が無ければ空状態の説明を表示する", async () => {
    render(<MatchHistoryList />);

    expect(
      await screen.findByText(/保存された戦績はまだありません/),
    ).toBeInTheDocument();
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

    // 展開すると結果画面と同じ最終順位・ソシー内訳を閲覧できる。
    const details = items[0].querySelector("details");
    if (!details) throw new Error("details が無い");
    expect(details.open).toBe(false);
    fireEvent.click(items[0].querySelector("summary") as HTMLElement);
    expect(details.open).toBe(true);
    const opened = within(items[0] as HTMLElement);
    expect(opened.getByRole("table")).toBeInTheDocument();
    expect(
      opened.getByRole("region", { name: "四郎のソシー内訳" }),
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

    expect(window.localStorage.getItem(MATCH_HISTORY_KEY)).toBeNull();
    expect(
      screen.getByText(/保存された戦績はまだありません/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("保存されていた戦績をすべて削除しました。"),
    ).toBeInTheDocument();
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
    expect(
      screen.getByText(/この端末では戦績を削除できませんでした/),
    ).toBeInTheDocument();
    // 確認UIは畳まない。畳むと押したボタンが消え、フォーカスが body へ落ちる。
    expect(confirmButton).toBeInTheDocument();
    expect(confirmButton).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });

  it("全件削除後はフォーカスを空状態へ移し、bodyへ落とさない", async () => {
    appendHistory(window.localStorage, entry(1, 1_753_000_000_000));

    render(<MatchHistoryList />);
    fireEvent.click(
      await screen.findByRole("button", { name: "戦績をすべて削除" }),
    );
    // 押した「削除する」ボタンごとセクションが消えるため、フォーカスの行き先が要る。
    fireEvent.click(screen.getByRole("button", { name: "削除する" }));

    const emptyState = screen
      .getByText(/保存された戦績はまだありません/)
      .closest("div");
    expect(emptyState).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });
});
