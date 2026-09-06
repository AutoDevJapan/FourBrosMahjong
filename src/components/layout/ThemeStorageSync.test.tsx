import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeStorageSync } from "./ThemeStorageSync";
import { ThemeToggle } from "./ThemeToggle";

function stubMatchMedia(prefersDark = false) {
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
  stubMatchMedia();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("ThemeStorageSync", () => {
  it("mount前に保存されたthemeへDOMをcatch-upする", () => {
    localStorage.setItem("theme", "dark");

    render(<ThemeStorageSync />);

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("listener登録直前の取り逃がしを現在値の読直しで回収する", () => {
    const addEventListener = window.addEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation(
      (type, listener, options) => {
        if (type === "storage") {
          // listenerがまだ無い瞬間に別タブが書いた状態を決定的に再現する。
          localStorage.setItem("theme", "light");
        }
        return addEventListener(type, listener, options);
      },
    );

    render(<ThemeStorageSync />);

    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("listener登録直後の変更をeventで回収してmount読直しとも収束する", () => {
    const addEventListener = window.addEventListener.bind(window);
    let changedDuringRegistration = false;
    vi.spyOn(window, "addEventListener").mockImplementation(
      (type, listener, options) => {
        const result = addEventListener(type, listener, options);
        if (type === "storage" && !changedDuringRegistration) {
          changedDuringRegistration = true;
          localStorage.setItem("theme", "dark");
          window.dispatchEvent(
            new StorageEvent("storage", { key: "theme", newValue: "dark" }),
          );
        }
        return result;
      },
    );

    render(<ThemeStorageSync />);

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("BFCacheからの復帰時に取り逃がした保存値へcatch-upする", () => {
    render(<ThemeStorageSync />);

    // ページがBFCacheで停止している間に別タブから変更された状態を模擬する。
    localStorage.setItem("theme", "dark");
    const pageShow = new Event("pageshow");
    Object.defineProperty(pageShow, "persisted", { value: true });
    window.dispatchEvent(pageShow);

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  });

  it("system選択の現在値で古いdata-themeを除去する", () => {
    document.documentElement.setAttribute("data-theme", "dark");

    render(<ThemeStorageSync />);

    expect(document.documentElement).not.toHaveAttribute("data-theme");
  });

  it("StrictModeのeffect再実行でも現在値へ冪等に収束する", () => {
    localStorage.setItem("theme", "dark");
    const { unmount } = render(
      <StrictMode>
        <ThemeStorageSync />
      </StrictMode>,
    );

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    localStorage.setItem("theme", "light");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "theme", newValue: "light" }),
    );
    expect(document.documentElement).toHaveAttribute("data-theme", "light");

    unmount();
    localStorage.setItem("theme", "dark");
    window.dispatchEvent(
      new StorageEvent("storage", { key: "theme", newValue: "dark" }),
    );
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });

  it("mount catch-upではstorage失敗時の揮発選択を破棄しない", async () => {
    const user = userEvent.setup();
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("Storage disabled", "SecurityError");
      });
    render(<ThemeToggle />);
    await user.click(screen.getByRole("radio", { name: "ダーク" }));
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    render(<ThemeStorageSync />);

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(screen.getByRole("radio", { name: "ダーク" })).toBeChecked();

    const pageShow = new Event("pageshow");
    Object.defineProperty(pageShow, "persisted", { value: true });
    window.dispatchEvent(pageShow);
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(screen.getByRole("radio", { name: "ダーク" })).toBeChecked();

    // 実際の外部storage変更だけが揮発fallbackを破棄する。
    setItem.mockRestore();
    localStorage.clear();
    await act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: "theme", newValue: null }),
      );
    });
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    await waitFor(() =>
      expect(
        screen.getByRole("radio", { name: "システム設定に従う" }),
      ).toBeChecked(),
    );
  });
});
