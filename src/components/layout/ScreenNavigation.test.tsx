import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ScreenNavigation from "./ScreenNavigation";

describe("ScreenNavigation", () => {
  it("現在の画面を除く主要画面へのリンクを折りたたみ内に表示する", () => {
    render(<ScreenNavigation currentPath="/settings" />);

    const navigation = screen.getByRole("navigation", { name: "画面メニュー" });
    expect(within(navigation).getByText("他の画面へ")).toBeInTheDocument();
    expect(
      within(navigation).getByRole("link", { name: /対局を開始/ }),
    ).toHaveAttribute("href", "/game");
    expect(
      within(navigation).getByRole("link", { name: /ルール説明/ }),
    ).toHaveAttribute("href", "/rules");
    expect(
      within(navigation).getByRole("link", { name: /^戦績/ }),
    ).toHaveAttribute("href", "/history");
    expect(
      within(navigation).getByRole("link", { name: /オンライン対戦/ }),
    ).toHaveAttribute("href", "/online");
    expect(
      within(navigation).queryByRole("link", { name: /^設定/ }),
    ).toBeNull();
    expect(navigation.querySelector("details")).not.toHaveAttribute("open");
  });

  it("結果画面では新しい対局への重複導線を表示しない", () => {
    render(
      <ScreenNavigation currentPath="/game/result" showGameLink={false} />,
    );

    const navigation = screen.getByRole("navigation", { name: "画面メニュー" });
    expect(
      within(navigation).queryByRole("link", { name: /対局を開始/ }),
    ).toBeNull();
    expect(
      within(navigation).getByRole("link", { name: /^設定/ }),
    ).toHaveAttribute("href", "/settings");
  });
});
