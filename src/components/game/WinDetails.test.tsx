import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RoundSummary } from "@/domain/game/engine";
import WinDetails from "./WinDetails";

/** 和了形スナップショットの既定値(#259)。単騎待ちの13枚+和了牌。 */
const WIN_HAND = {
  winnerName: "あなた",
  winnerSeat: "south",
  hand: [
    { suit: "man", rank: 1, isRed: false },
    { suit: "man", rank: 1, isRed: false },
    { suit: "man", rank: 1, isRed: false },
    { suit: "pin", rank: 2, isRed: false },
    { suit: "pin", rank: 2, isRed: false },
    { suit: "pin", rank: 2, isRed: false },
    { suit: "sou", rank: 3, isRed: false },
    { suit: "sou", rank: 3, isRed: false },
    { suit: "sou", rank: 3, isRed: false },
    { suit: "sou", rank: 5, isRed: true },
    { suit: "sou", rank: 5, isRed: true },
    { suit: "honor", rank: 2, isRed: false },
    { suit: "honor", rank: 2, isRed: false },
  ],
  winningTile: { suit: "honor", rank: 2, isRed: false },
} as const;

const winSummary: RoundSummary = {
  kind: "win",
  label: "あなたのツモ 12,000点",
  deltas: { p0: 13000, p1: -7500, p2: -4500, p3: 0 },
  winDetails: {
    winType: "tsumo",
    dealer: false,
    ...WIN_HAND,
    yaku: [{ name: "立直", han: 1, yakuman: 0 }],
    yakuHan: 1,
    dora: { omote: 0, ura: 0, aka: 0, gari: 0, total: 0 },
    totalHan: 1,
    yakuman: 0,
    category: "normal",
    honba: 0,
    riichiSticks: 0,
    payments: [],
    stickPayout: 0,
  },
};

describe("WinDetails", () => {
  it("複数のレスポンシブ盤面でも各内訳を自身の見出しでラベル付けする", () => {
    const { container } = render(
      <>
        <WinDetails summary={winSummary} />
        <WinDetails summary={winSummary} />
      </>,
    );

    const sections = screen.getAllByRole("region", { name: "和了内訳" });
    expect(sections).toHaveLength(2);
    const labelledBy = sections.map((section) =>
      section.getAttribute("aria-labelledby"),
    );
    expect(new Set(labelledBy).size).toBe(2);
    for (const id of labelledBy) {
      expect(id).not.toBeNull();
      expect(container.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
    }
  });

  it("流局では和了内訳を描画しない", () => {
    const { container } = render(
      <WinDetails
        summary={{
          kind: "draw",
          label: "流局",
          deltas: { p0: 0, p1: 0, p2: 0, p3: 0 },
        }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("和了者名と席を和了内訳の冒頭に表示する(#259)", () => {
    render(<WinDetails summary={winSummary} />);
    expect(screen.getByText("あなた(南家)")).toBeInTheDocument();
  });

  it("和了形(手牌13枚+和了牌)を表向きで開示し、和了牌をaria-labelで区別する(#259)", () => {
    render(<WinDetails summary={winSummary} />);
    const list = screen.getByRole("list", { name: "和了形" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(14);
    // 手牌13枚は Tile(role="img")として表向きに描かれる(南=2z は手牌に2枚)。
    expect(within(list).getAllByRole("img", { name: "南" })).toHaveLength(2);
    expect(
      within(list).getAllByRole("img", { name: "五索(赤ドラ)" }),
    ).toHaveLength(2);
    // 和了牌は色に依存しない aria-label(和了牌)で区別する(スペック5 5.2.1)。
    const winningItem = within(list).getByRole("listitem", {
      name: "南(和了牌)",
    });
    expect(winningItem).toBeInTheDocument();
    expect(within(winningItem).getByText("和了")).toBeInTheDocument();
  });

  it("名前付きリスト(和了形/成立役/支払い内訳)にrole=listを明示する(スペック5 5.2.5 / #270)", () => {
    render(<WinDetails summary={winSummary} />);
    // role クエリは暗黙ロールでも通るため、Safari/VoiceOver 対策の明示ロールは属性で回帰検証する。
    for (const name of ["和了形", "成立役", "支払い内訳"]) {
      expect(screen.getByRole("list", { name })).toHaveAttribute(
        "role",
        "list",
      );
    }
  });

  it("役・ドラ4区分・合計翻・本場供託・支払いを表示する", () => {
    const summary: RoundSummary = {
      kind: "win",
      label: "あなたのツモ 12,000点",
      deltas: { p0: 13000, p1: -7500, p2: -4500, p3: 0 },
      winDetails: {
        winType: "tsumo",
        dealer: false,
        ...WIN_HAND,
        yaku: [
          { name: "立直", han: 1, yakuman: 0 },
          { name: "門前清自摸和", han: 1, yakuman: 0 },
        ],
        yakuHan: 2,
        dora: { omote: 2, ura: 1, aka: 1, gari: 2, total: 6 },
        totalHan: 8,
        yakuman: 0,
        category: "baiman",
        honba: 1,
        riichiSticks: 1,
        payments: [
          { name: "一郎", amount: 7500 },
          { name: "二郎", amount: 4500 },
        ],
        stickPayout: 1000,
      },
    };
    render(<WinDetails summary={summary} />);
    expect(
      screen.getByRole("heading", { name: "和了内訳" }),
    ).toBeInTheDocument();
    expect(screen.getByText("立直")).toBeInTheDocument();
    expect(screen.getByText("表ドラ").nextElementSibling).toHaveTextContent(
      "2翻",
    );
    expect(screen.getByText("裏ドラ").nextElementSibling).toHaveTextContent(
      "1翻",
    );
    expect(screen.getByText("赤5").nextElementSibling).toHaveTextContent("1翻");
    expect(screen.getByText("ガリ").nextElementSibling).toHaveTextContent(
      "2翻",
    );
    expect(screen.getByText("合計").nextElementSibling).toHaveTextContent(
      "8翻",
    );
    expect(screen.getByText("一郎: 7,500点")).toBeInTheDocument();
  });

  it("同名の支払者2名でもkeyが衝突せず金額が支払者ごとに対応する(スペック6 6.2.1 / #312)", () => {
    // /settings は対局者名の重複を禁止しない(sanitizePlayerName に重複排除は無い)。
    // ツモ和了は支払者が2名以上になるため、同名設定の衝突が顕在化する経路。
    const summary: RoundSummary = {
      kind: "win",
      label: "あなたのツモ 12,000点",
      deltas: { p0: 13000, p1: -7500, p2: -4500, p3: 0 },
      winDetails: {
        winType: "tsumo",
        dealer: false,
        ...WIN_HAND,
        yaku: [{ name: "立直", han: 1, yakuman: 0 }],
        yakuHan: 1,
        dora: { omote: 0, ura: 0, aka: 0, gari: 0, total: 0 },
        totalHan: 1,
        yakuman: 0,
        category: "normal",
        honba: 0,
        riichiSticks: 0,
        payments: [
          { name: "太郎", amount: 7500 },
          { name: "太郎", amount: 4500 },
        ],
        stickPayout: 0,
      },
    };
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<WinDetails summary={summary} />);

    const list = screen.getByRole("list", { name: "支払い内訳" });
    const items = within(list).getAllByRole("listitem");
    // 同名でも2件が独立して描画され、金額は名前ではなく支払者(位置)ごとに対応する。
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("太郎: 7,500点");
    expect(items[1]).toHaveTextContent("太郎: 4,500点");
    // React の key 重複警告(console.error)が出ないことをもって key の一意性を回帰検証する。
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("天和+国士無双と合計2倍役満を和了内訳に表示する", () => {
    const summary: RoundSummary = {
      kind: "win",
      label: "あなたのツモ 96,000点",
      deltas: { p0: 96000, p1: -48000, p2: -48000, p3: 0 },
      winDetails: {
        winType: "tsumo",
        dealer: true,
        ...WIN_HAND,
        winnerSeat: "east",
        yaku: [
          { name: "天和", han: 0, yakuman: 1 },
          { name: "国士無双", han: 0, yakuman: 1 },
        ],
        yakuHan: 0,
        dora: { omote: 0, ura: 0, aka: 0, gari: 0, total: 0 },
        totalHan: 0,
        yakuman: 2,
        category: "yakuman",
        honba: 0,
        riichiSticks: 0,
        payments: [],
        stickPayout: 0,
      },
    };
    render(<WinDetails summary={summary} />);
    expect(screen.getByText("天和")).toBeInTheDocument();
    expect(screen.getByText("国士無双")).toBeInTheDocument();
    expect(screen.getByText("合計").nextElementSibling).toHaveTextContent(
      "2倍役満",
    );
  });
});
