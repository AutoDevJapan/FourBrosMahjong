import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import PlayerArea from "./PlayerArea";
import type { SeatedPlayerView } from "./types";

const PLAYER: SeatedPlayerView = {
  playerId: "p0",
  name: "粗悪品",
  points: 35000,
  seatWind: "east",
  hand: [],
  kitaCount: 0,
  discards: [],
};

describe("PlayerArea status badges (spec 5.2.1)", () => {
  it("自分を可視badgeとstate-drivenなaccessible nameの両方で示す", () => {
    const { rerender } = render(
      <PlayerArea player={{ ...PLAYER, status: {} }} isSelf />,
    );

    const self = screen.getByRole("region", {
      name: "粗悪品(あなた・東家)",
    });
    expect(self).toHaveAttribute("data-player-role", "self");
    expect(screen.getByText("あなた")).toBeVisible();

    rerender(<PlayerArea player={{ ...PLAYER, status: {} }} isSelf={false} />);
    expect(
      screen.getByRole("region", { name: "粗悪品(東家)" }),
    ).toHaveAttribute("data-player-role", "opponent");
    expect(screen.queryByText("あなた")).not.toBeInTheDocument();
  });

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

  it.each([
    ["discard", "禁フリテン（捨て牌）"],
    ["temporary", "禁フリテン（同巡内）"],
    ["riichi", "禁フリテン（リーチ後）"],
  ] as const)("%s フリテンの理由をアイコン+テキストで示す", (reason, label) => {
    render(
      <PlayerArea
        player={{ ...PLAYER, status: { furitenReason: reason } }}
        isSelf
      />,
    );

    expect(screen.getByTestId("status-badge-furiten")).toHaveTextContent(label);
  });

  it("フリテンでないときはフリテンバッジを描画しない", () => {
    render(<PlayerArea player={{ ...PLAYER, status: {} }} isSelf />);
    expect(
      screen.queryByTestId("status-badge-furiten"),
    ).not.toBeInTheDocument();
  });
});
