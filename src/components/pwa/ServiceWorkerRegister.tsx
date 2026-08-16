"use client";

import { useEffect } from "react";
import { registerServiceWorker } from "./serviceWorkerRegistration";

/**
 * マウント時に service worker を登録する(issue #292)。UI は描画しない。
 *
 * 判定・登録の実体は `serviceWorkerRegistration.ts` を参照。production 以外
 * (dev / test / E2E の dev サーバー)では何もしない。
 */
export function ServiceWorkerRegister(): null {
  useEffect(() => {
    registerServiceWorker(process.env.NODE_ENV, navigator);
  }, []);
  return null;
}
