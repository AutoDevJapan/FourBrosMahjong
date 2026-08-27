import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage, { metadata } from "./page";

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("Issue #712 Phase B2 設定", () => {
  it("テーマ・四兄弟名・既存の戦績/戻る導線だけを表示する", () => {
    const { container } = render(<SettingsPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: "設定" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 2, name: "表示モード" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 2, name: "四兄弟の表示名" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "ロビーへ戻る" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByRole("link", { name: /戦績を見る/ })).toHaveAttribute(
      "href",
      "/history",
    );
    expect(
      container.querySelector(".design-page-shell.settings-page"),
    ).not.toBeNull();
    expect(
      container.querySelector(".design-panel.settings-panel"),
    ).not.toBeNull();
  });

  it("テーマradioをsystem/light/darkのDOM順で保つ", () => {
    render(<SettingsPage />);

    const group = screen.getByRole("group", { name: "テーマ(表示モード)" });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((radio) => radio.getAttribute("value")),
    ).toEqual(["system", "light", "dark"]);
  });

  it("reference注釈・固定席・未実装設定・reference PNGをruntimeへ持ち込まない", () => {
    const { container } = render(<SettingsPage />);

    for (const text of [
      "③",
      "設定画面",
      "東家",
      "南家",
      "西家",
      "北家",
      "自家",
      "他家",
      "サウンド",
      "音量",
      "その他",
      "へちま",
    ]) {
      expect(
        screen.queryByText(text, { exact: false }),
      ).not.toBeInTheDocument();
    }
    for (const image of container.querySelectorAll("img")) {
      expect(image.getAttribute("src")).not.toContain("ui-refresh");
      expect(image.getAttribute("src")).not.toContain("settings.png");
    }
  });

  it("ページ固有metadataを維持する", () => {
    expect(metadata.title).toBe("設定");
    expect(metadata.description).toMatch(/テーマ/);
  });
});
