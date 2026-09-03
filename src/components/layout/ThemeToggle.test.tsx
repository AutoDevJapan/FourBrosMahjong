import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "./ThemeToggle";

/**
 * jsdom は `window.matchMedia` を実装しないため、テストごとに差し替える。
 * `matches` を切り替えることで OS のカラースキーム初期値を模擬する。
 */
function stubMatchMedia(prefersDark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: prefersDark,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

beforeEach(() => {
  stubMatchMedia(false);
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("ThemeToggle", () => {
  it("未選択のときは『システム設定に従う』が選択される", async () => {
    render(<ThemeToggle />);

    const systemRadio = await screen.findByRole("radio", {
      name: "システム設定に従う",
    });
    expect(systemRadio).toBeChecked();
    // 未選択のあいだは data-theme 属性を付与しない(prefers-color-scheme に委譲)。
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("ダークを選ぶと data-theme='dark' を付与し localStorage に保存する", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("radio", { name: "ダーク" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(screen.getByRole("radio", { name: "ダーク" })).toBeChecked();
  });

  it("システムに戻すと data-theme を外し localStorage を消す", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("radio", { name: "ライト" }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(localStorage.getItem("theme")).toBe("light");

    await user.click(screen.getByRole("radio", { name: "システム設定に従う" }));
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem("theme")).toBeNull();
  });

  it("保存済みの選択(dark)をマウント時に復元する", async () => {
    localStorage.setItem("theme", "dark");
    render(<ThemeToggle />);

    const darkRadio = await screen.findByRole("radio", { name: "ダーク" });
    expect(darkRadio).toBeChecked();
  });

  it("既存の保存値が残る保存失敗時も現在タブの選択を維持する", async () => {
    const user = userEvent.setup();
    localStorage.setItem("theme", "light");
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("QuotaExceededError");
      });
    render(<ThemeToggle />);

    await user.click(screen.getByRole("radio", { name: "ダーク" }));

    expect(screen.getByRole("radio", { name: "ダーク" })).toBeChecked();
    expect(screen.getByText(/現在の表示:/)).toHaveTextContent(
      "ダーク(手動で固定中)",
    );

    setItem.mockRestore();
    await user.click(screen.getByRole("radio", { name: "システム設定に従う" }));
  });

  it("既存の保存値を削除できない場合もシステム設定を選択状態にする", async () => {
    const user = userEvent.setup();
    localStorage.setItem("theme", "dark");
    const removeItem = vi
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation(() => {
        throw new DOMException("SecurityError");
      });
    render(<ThemeToggle />);

    await user.click(screen.getByRole("radio", { name: "システム設定に従う" }));

    expect(
      screen.getByRole("radio", { name: "システム設定に従う" }),
    ).toBeChecked();
    expect(screen.getByText(/現在の表示:/)).toHaveTextContent(
      "ライト(システム設定に追従中)",
    );
    expect(document.documentElement).not.toHaveAttribute("data-theme");

    removeItem.mockRestore();
    await user.click(screen.getByRole("radio", { name: "ダーク" }));
    await user.click(screen.getByRole("radio", { name: "システム設定に従う" }));
  });

  it("システム追従時は OS のダーク設定を実効テーマとして表示する", async () => {
    stubMatchMedia(true);
    render(<ThemeToggle />);

    // 実効テーマ(ダーク)と「システム追従中」であることが色に依存せず読める。
    const status = await screen.findByText(/現在の表示:/);
    expect(status).toHaveTextContent("ダーク");
    expect(status).toHaveTextContent("システム設定に追従中");
    // 未選択なので data-theme は付与されない。
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("localStorageへの保存失敗時も現在タブの選択と表示を一致させる", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError");
    });
    render(<ThemeToggle />);

    await user.click(screen.getByRole("radio", { name: "ダーク" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(screen.getByRole("radio", { name: "ダーク" })).toBeChecked();
    expect(screen.getByText(/現在の表示:/)).toHaveTextContent(
      "ダーク(手動で固定中)",
    );
    // removeItem は利用可能な想定なので、モジュール内の揮発設定も後続テスト前に戻す。
    await user.click(screen.getByRole("radio", { name: "システム設定に従う" }));
  });

  it("別タブの変更をstorageイベントでradioとDOMへ反映する", async () => {
    render(<ThemeToggle />);
    localStorage.setItem("theme", "dark");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "theme", newValue: "dark" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "ダーク" })).toBeChecked(),
    );
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });
});
