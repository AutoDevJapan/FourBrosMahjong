/**
 * Service worker 登録ロジック(issue #292)。
 *
 * 登録は **production のみ**。開発サーバー(`pnpm dev`)や E2E の dev 実行で SW を
 * 登録すると、キャッシュが以降のテスト・開発を汚染するため無効化する(定石)。
 * コンポーネント(`ServiceWorkerRegister.tsx`)から環境と navigator を注入する形にして、
 * jsdom/node のユニットテストで判定と登録呼び出しを検証できるようにしている。
 */

/** SW スクリプトの配信 URL(`src/app/sw.js/route.ts`)。ルート直下 = スコープ `/`。 */
export const SERVICE_WORKER_URL = "/sw.js";

/**
 * 条件を満たす場合のみ service worker を登録する。
 *
 * @returns 登録を開始した場合 `true`(production かつ `serviceWorker` 対応ブラウザ)。
 */
export function registerServiceWorker(
  nodeEnv: string | undefined,
  nav: Navigator | undefined,
): boolean {
  if (nodeEnv !== "production") {
    return false;
  }
  if (!nav || !("serviceWorker" in nav)) {
    return false;
  }
  nav.serviceWorker.register(SERVICE_WORKER_URL).catch(() => {
    // 登録失敗(プライベートブラウジング等)はオンライン動作へ影響しないため黙って続行する。
    // オフライン強化は progressive enhancement であり、失敗をユーザーへ通知する必要はない。
  });
  return true;
}
