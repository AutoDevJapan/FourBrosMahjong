import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PlayerSlot from "./PlayerSlot";
import type { SlotContent } from "./types";

describe("PlayerSlot (seated / bench switch, spec 6.4.1)", () => {
  it("renders a face-up interactive hand for the self seat", () => {
    const content: SlotContent = {
      kind: "seated",
      player: {
        name: "あなた",
        points: 35000,
        seatWind: "east",
        hand: [
          { suit: "man", rank: 1 },
          { suit: "sou", rank: 9 },
        ],
        discards: [],
      },
    };
    render(<PlayerSlot position="self" content={content} />);
    // Self hand is the interactive listbox.
    expect(
      screen.getByRole("listbox", { name: "自家の手牌" }),
    ).toBeInTheDocument();
  });

  it("hides opponent tile faces and shows only the count", () => {
    const content: SlotContent = {
      kind: "seated",
      player: {
        name: "下家",
        points: 25000,
        seatWind: "west",
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
      player: { name: "対面", points: 32000 },
    };
    render(<PlayerSlot position="across" content={content} />);
    expect(
      screen.getByRole("region", { name: "対面(抜け番)" }),
    ).toBeInTheDocument();
    expect(screen.getByText("抜け番")).toBeInTheDocument();
  });
});
