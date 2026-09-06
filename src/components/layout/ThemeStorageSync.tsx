"use client";

import { useEffect } from "react";
import {
  reconcileThemeFromStorage,
  subscribeThemeStorage,
} from "./ThemeToggle";

/**
 * 別タブのテーマ変更を、現在のルートに関係なく反映する全ページ共通の同期境界。
 * 設定UIが未マウントのロビー・対局画面でも data-theme を保存値と一致させる。
 */
export function ThemeStorageSync() {
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      // BFCacheからの復帰ではmountされず、復帰中のstorage eventを
      // 取り逃がすことがあるため、現在値を再読してDOMをcatch-upする。
      // lifecycle通知では揮発fallbackを外部変更とみなして破棄しない。
      reconcileThemeFromStorage();
    };
    // listenerを先に登録し、その直後に現在値へcatch-upする。
    // 変更がlistener登録より前ならcatch-up、後ならeventが拾うため、
    // hydrationと別タブ書き込みの順序にかかわらず現在値へ収束する。
    const unsubscribeStorage = subscribeThemeStorage();
    window.addEventListener("pageshow", handlePageShow);
    reconcileThemeFromStorage();
    return () => {
      unsubscribeStorage();
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  return null;
}
