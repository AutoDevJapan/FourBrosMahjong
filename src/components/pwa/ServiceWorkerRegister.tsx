"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "./serviceWorkerRegistration";

/**
 * `navigator` is normally available in a browser, but embedded client hosts
 * can omit or reject the global. Service Worker registration is optional, so
 * resolving that capability must not make the application shell fail.
 */
function getNavigatorOrUndefined(): Navigator | undefined {
  try {
    return typeof navigator === "undefined" ? undefined : navigator;
  } catch {
    return undefined;
  }
}

/**
 * マウント時に service worker を登録する(issue #292)。UI は描画しない。
 *
 * 判定・登録の実体は `serviceWorkerRegistration.ts` を参照。production 以外
 * (dev / test / E2E の dev サーバー)では何もしない。
 */
export function ServiceWorkerRegister(): null {
  useEffect(() => {
    registerServiceWorker(process.env.NODE_ENV, getNavigatorOrUndefined());
  }, []);
  return null;
}
