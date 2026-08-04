import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PlayerArea from "./PlayerArea";
import type { SeatedPlayerView } from "./types";

const PLAYER: SeatedPlayerView = {
  name: "あなた",
  points: 35000,
  seatWind: "east",
  hand: [],
  kitaCount: 0,
  discards: [],
};

describe("PlayerArea status badges (spec 5.2.1)", () => {
  it("手番と親を色だけでなくアイコン+テキストのバッジで示す", () => {
    render(
      <PlayerArea
        player={{
          ...PLAYER,
          status: { isCurrentTurn: true, isDealer: true },
        }}
        isSelf
      />,
    );

    expect(screen.getByTestId("status-badge-highlight")).toHaveTextContent(
      "▶手番",
    );
    expect(screen.getByTestId("status-badge-default")).toHaveTextContent("◆親");
  });

  it("手番でも親でもないときは対応するバッジを描画しない", () => {
    render(
      <PlayerArea
        player={{
          ...PLAYER,
          status: { isCurrentTurn: false, isDealer: false },
        }}
        isSelf
      />,
    );

    expect(
      screen.queryByTestId("status-badge-highlight"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("status-badge-default"),
    ).not.toBeInTheDocument();
  });
});
