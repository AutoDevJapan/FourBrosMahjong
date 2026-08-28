"use client";

import { useEffect } from "react";
import { reconcileThemeFromStorage, syncThemeFromStorage } from "./ThemeToggle";

/**
 * 別タブのテーマ変更を、現在のルートに関係なく反映する全ページ共通の同期境界。
 * 設定UIが未マウントのロビー・対局画面でも data-theme を保存値と一致させる。
 */
export function ThemeStorageSync() {
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "theme" || event.key === null) {
        syncThemeFromStorage();
      }
    };
    // listenerを先に登録し、その直後に現在値へcatch-upする。
    // 変更がlistener登録より前ならcatch-up、後ならeventが拾うため、
    // hydrationと別タブ書き込みの順序にかかわらず現在値へ収束する。
    window.addEventListener("storage", handleStorage);
    reconcileThemeFromStorage();
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return null;
}
