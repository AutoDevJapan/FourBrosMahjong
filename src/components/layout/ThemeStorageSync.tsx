"use client";

import { useEffect } from "react";
import { syncThemeFromStorage } from "./ThemeToggle";

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
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return null;
}
