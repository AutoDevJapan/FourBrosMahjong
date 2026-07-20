// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
