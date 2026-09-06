import { render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ScreenNavigation from "./ScreenNavigation";

describe("ScreenNavigation", () => {
  it("SSRの殻を操作可能と誤認させるmarkerを出力しない", () => {
    const html = renderToStaticMarkup(
      <ScreenNavigation currentPath="/settings" />,
    );

    expect(html).not.toContain("data-navigation-hydrated");
  });

  it("操作可能になったことを明示し、unmount時にmarkerを除去する", () => {
    const view = render(<ScreenNavigation currentPath="/settings" />);
    const navigation = screen.getByRole("navigation", { name: "画面メニュー" });

    expect(navigation).toHaveAttribute("data-navigation-hydrated", "true");
    view.unmount();
    expect(navigation).not.toHaveAttribute("data-navigation-hydrated");
  });

  it("hydration markerのsetAttribute失敗でもナビゲーションをmountできる", () => {
    const originalSetAttribute = HTMLElement.prototype.setAttribute;
    const setAttribute = vi
      .spyOn(HTMLElement.prototype, "setAttribute")
      .mockImplementation(function (this: HTMLElement, name, value) {
        if (name === "data-navigation-hydrated") {
          throw new Error("attribute writes are unavailable");
        }
        originalSetAttribute.call(this, name, value);
      });

    expect(() =>
      render(<ScreenNavigation currentPath="/settings" />),
    ).not.toThrow();
    expect(
      screen.getByRole("navigation", { name: "画面メニュー" }),
    ).toBeInTheDocument();

    setAttribute.mockRestore();
  });

  it("hydration markerのremoveAttribute失敗でもunmountできる", () => {
    const view = render(<ScreenNavigation currentPath="/settings" />);
    const navigation = screen.getByRole("navigation", { name: "画面メニュー" });
    const originalRemoveAttribute = HTMLElement.prototype.removeAttribute;
    const removeAttribute = vi
      .spyOn(HTMLElement.prototype, "removeAttribute")
      .mockImplementation(function (this: HTMLElement, name) {
        if (name === "data-navigation-hydrated") {
          throw new Error("attribute removals are unavailable");
        }
        originalRemoveAttribute.call(this, name);
      });

    expect(() => view.unmount()).not.toThrow();
    expect(navigation).toHaveAttribute("data-navigation-hydrated", "true");

    removeAttribute.mockRestore();
  });

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
