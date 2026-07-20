/**
 * Service worker スクリプト生成(issue #292 / スペック6 6.9 オフライン方針)。
 *
 * 対局は完全にクライアント内(`GameProvider` の React state + `sessionStorage` ジャーナル)で
 * 完結するため、静的アセットさえキャッシュされていればオフラインで起動・継続できる。
 * ここでは外部ライブラリ(Workbox 等)に依存せず、必要最小限の自前 SW を文字列として生成する。
 *
 * 配信は `src/app/sw.js/route.ts`(`force-static`)が担い、ビルドごとに一意の `version` を
 * 埋め込む。version が変わると install → activate で旧 `fbm-*` キャッシュが全て破棄されるため、
 * デプロイ後に古いシェルが残らない(issue #292 受け入れ条件)。
 *
 * キャッシュ戦略:
 * - ナビゲーション(HTML): network-first。オンライン時は常に最新シェルを取得し、
 *   オフライン時のみキャッシュ(最後は `/` へフォールバック)で応答する。
 * - `/_next/static/`(コンテンツハッシュ付き)・牌 SVG・アイコン: cache-first(実質不変)。
 * - その他の同一オリジン GET(RSC ペイロード・フォント等): network-first + キャッシュ退避。
 *
 * 生成文字列内では `self.*` を明示参照する(暗黙のグローバル参照を避け、Vitest で
 * 偽の ServiceWorkerGlobalScope を注入してハンドラの挙動を検証できるようにするため)。
 */
import { TILE_ASSET_URLS } from "@/components/common/tileImage";

/** オフライン起動対象の全ルート(App Router のユーザー向け画面)。 */
export const PRECACHE_ROUTES: readonly string[] = [
  "/",
  "/rules",
  "/settings",
  // 戦績は localStorage 完結でオフラインでも中身を表示できる(issue #293)。
  "/history",
  "/game",
  "/game/result",
];

/** ルート以外にプリキャッシュする静的アセット(PWA アイコン・全牌素材)。 */
export const PRECACHE_ASSETS: readonly string[] = [
  "/manifest.webmanifest",
  "/icon.svg",
  "/icons/icon-192",
  "/icons/icon-512",
  ...TILE_ASSET_URLS,
];

/**
 * SW のキャッシュバージョンを決定する。
 *
 * Vercel ビルドではコミット SHA(デプロイごとに一意)を使う。ローカルビルドでは
 * ビルド時刻ベースのフォールバックを使う(`force-static` ルートはビルド時に一度だけ
 * 評価されるため、ビルドごとに一意になる)。
 */
export function resolveServiceWorkerVersion(
  env: Record<string, string | undefined> = process.env,
  now: () => number = Date.now,
): string {
  const sha = env.VERCEL_GIT_COMMIT_SHA;
  if (sha) {
    return sha.slice(0, 12);
  }
  return `local-${now().toString(36)}`;
}

/** 生成した SW スクリプト(JavaScript ソース文字列)を返す。 */
export function buildServiceWorkerScript(version: string): string {
  const precacheUrls = [...PRECACHE_ROUTES, ...PRECACHE_ASSETS];
  return `/* 四兄弟麻雀 service worker (generated: src/app/sw.js/route.ts, issue #292) */
"use strict";

const VERSION = ${JSON.stringify(version)};
const OWNED_CACHE_PREFIX = "fbm-";
const PRECACHE = OWNED_CACHE_PREFIX + "precache-" + VERSION;
const RUNTIME = OWNED_CACHE_PREFIX + "runtime-" + VERSION;
const PRECACHE_URLS = ${JSON.stringify(precacheUrls)};
const NAVIGATION_FALLBACK_URL = "/";

/** コンテンツハッシュ付き・または実質不変の静的アセットか。 */
function isImmutableAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/tiles/") ||
    pathname.startsWith("/icons/") ||
    pathname === "/icon.svg"
  );
}

async function putRuntimeCache(request, response) {
  const cache = await self.caches.open(RUNTIME);
  await cache.put(request, response);
}

/** network-first: 成功したらキャッシュへ退避し、失敗(オフライン)時はキャッシュで応答する。 */
async function networkFirst(request, fallbackUrl) {
  try {
    const response = await self.fetch(request);
    if (response.ok) {
      await putRuntimeCache(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await self.caches.match(request);
    if (cached) {
      return cached;
    }
    if (fallbackUrl) {
      const fallback = await self.caches.match(fallbackUrl);
      if (fallback) {
        return fallback;
      }
    }
    throw error;
  }
}

/** cache-first: 不変アセット用。キャッシュ済みなら network に一切出ない。 */
async function cacheFirst(request) {
  const cached = await self.caches.match(request);
  if (cached) {
    return cached;
  }
  const response = await self.fetch(request);
  if (response.ok) {
    await putRuntimeCache(request, response.clone());
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    self.caches
      .open(PRECACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      // 旧 SW の待機をスキップし、新バージョンを即時有効化する(古いシェル残留の防止)。
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    self.caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith(OWNED_CACHE_PREFIX) &&
                key !== PRECACHE &&
                key !== RUNTIME,
            )
            .map((key) => self.caches.delete(key)),
        ),
      )
      // 初回登録時からページを制御下に置き、リロード無しで fetch を仲介する。
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, NAVIGATION_FALLBACK_URL));
    return;
  }
  if (isImmutableAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  event.respondWith(networkFirst(request));
});
`;
}
