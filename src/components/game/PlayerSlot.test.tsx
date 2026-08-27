import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PlayerSlot from "./PlayerSlot";
import type { SlotContent } from "./types";

describe("PlayerSlot (seated / bench switch, spec 6.4.1)", () => {
  it("renders a face-up interactive hand for the self seat", () => {
    const content: SlotContent = {
      kind: "seated",
      player: {
        playerId: "p0",
        name: "あなた",
        points: 35000,
        seatWind: "east",
        kitaCount: 0,
        hand: [
          { suit: "man", rank: 1 },
          { suit: "sou", rank: 9 },
        ],
        discards: [],
      },
    };
    render(<PlayerSlot position="self" content={content} />);
    expect(
      screen.getByRole("region", { name: "あなた(あなた・東家)" }),
    ).toHaveAttribute("data-player-role", "self");
    // Self hand is the interactive listbox.
    expect(
      screen.getByRole("listbox", { name: "自家の手牌" }),
    ).toBeInTheDocument();
  });

  it("hides opponent tile faces and shows only the count", () => {
    const content: SlotContent = {
      kind: "seated",
      player: {
        playerId: "p1",
        name: "下家",
        points: 25000,
        seatWind: "west",
        kitaCount: 0,
        handCount: 13,
        discards: [],
      },
    };
    render(<PlayerSlot position="right" content={content} />);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByLabelText("手牌 13枚(伏せ)")).toBeInTheDocument();
  });

  it("renders a bench area with a non-color 抜け番 label when benched", () => {
    const content: SlotContent = {
      kind: "bench",
      player: { playerId: "p2", name: "対面", points: 32000 },
    };
    render(<PlayerSlot position="across" content={content} />);
    expect(
      screen.getByRole("region", { name: "対面(抜け番)" }),
    ).toBeInTheDocument();
    expect(screen.getByText("抜け番")).toBeInTheDocument();
    // フルサイズ(非 compact)では「この局は休み」の補足文を出す。
    expect(screen.getByText("この局は休み")).toBeInTheDocument();
    expect(screen.queryByText("あなた")).not.toBeInTheDocument();
  });

  it("自分が抜け番へ回っても可視・accessibleな自己識別を維持する", () => {
    const content: SlotContent = {
      kind: "bench",
      player: { playerId: "p1", name: "竜二", points: 35000 },
    };

    render(<PlayerSlot position="self" content={content} />);

    const selfBench = screen.getByRole("region", {
      name: "竜二(あなた・抜け番)",
    });
    expect(selfBench).toHaveAttribute("data-player-role", "self");
    expect(screen.getByText("あなた")).toBeVisible();
    expect(screen.getByText("抜け番")).toBeVisible();
  });

  it("collapses the bench slot to a compact band matching seated opponents (issue #150)", () => {
    const content: SlotContent = {
      kind: "bench",
      player: { playerId: "p2", name: "対面", points: 32000 },
    };
    render(<PlayerSlot position="across" content={content} compact />);
    // 名前・持ち点・抜け番バッジは残す。
    expect(
      screen.getByRole("region", { name: "対面(抜け番)" }),
    ).toBeInTheDocument();
    expect(screen.getByText("抜け番")).toBeInTheDocument();
    expect(screen.getByText("対面")).toBeInTheDocument();
    expect(screen.getByText("32,000")).toBeInTheDocument();
    // コンパクト帯では「この局は休み」の補足文を省き、着席他家と密度を揃える。
    expect(screen.queryByText("この局は休み")).not.toBeInTheDocument();
  });
});
